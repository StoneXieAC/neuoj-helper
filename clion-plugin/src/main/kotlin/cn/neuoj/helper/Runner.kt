package cn.neuoj.helper

import java.io.ByteArrayOutputStream
import java.nio.file.Files
import java.nio.file.Path
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import kotlin.concurrent.thread

data class ProcessResult(val stdout: String, val stderr: String, val exitCode: Int, val elapsedMs: Long, val failure: String? = null)

object Processes {
  fun execute(args: List<String>, cwd: Path, input: String = "", timeoutMs: Long, cancelled: AtomicBoolean, maxBytes: Long = 1_048_576): ProcessResult {
    if (cancelled.get()) return ProcessResult("", "", -1, 0, "已取消")
    val started = System.nanoTime()
    val process = ProcessBuilder(args).directory(cwd.toFile()).start()
    val size = AtomicLong()
    val exceeded = AtomicBoolean()
    val out = ByteArrayOutputStream()
    val err = ByteArrayOutputStream()
    fun reader(stream: java.io.InputStream, sink: ByteArrayOutputStream) = thread(isDaemon = true) {
      runCatching {
        stream.use {
          val buffer = ByteArray(8192)
          while (true) {
            val count = it.read(buffer)
            if (count < 0) break
            if (size.addAndGet(count.toLong()) > maxBytes) { exceeded.set(true); break }
            sink.write(buffer, 0, count)
          }
        }
      }
    }
    val stdout = reader(process.inputStream, out)
    val stderr = reader(process.errorStream, err)
    val writer = thread(isDaemon = true) { runCatching { process.outputStream.use { it.write(input.toByteArray(Charsets.UTF_8)) } } }
    var failure: String? = null
    val children = mutableMapOf<Long, ProcessHandle>()
    fun elapsed() = (System.nanoTime() - started) / 1_000_000
    while (true) {
      runCatching { process.descendants().use { stream -> stream.forEach { children[it.pid()] = it } } }
      failure = when {
        cancelled.get() -> "已取消"
        exceeded.get() -> "输出超限"
        elapsed() >= timeoutMs -> "超时"
        else -> null
      }
      if (failure != null || process.waitFor(10, TimeUnit.MILLISECONDS)) break
    }
    if (failure == null && exceeded.get()) failure = "输出超限"
    // 子进程可能继承管道；结束时一并清理，避免孤儿进程或阻塞读取。
    runCatching { process.descendants().use { descendants -> descendants.toList().asReversed().forEach { it.destroyForcibly() } } }
    children.values.toList().asReversed().forEach { if (it.isAlive) it.destroyForcibly() }
    if (process.isAlive) process.destroyForcibly()
    process.waitFor(2, TimeUnit.SECONDS)
    writer.join(1000); stdout.join(1000); stderr.join(1000)
    process.inputStream.close(); process.errorStream.close()
    if (exceeded.get() && failure == null) failure = "输出超限"
    return ProcessResult(out.toString(Charsets.UTF_8), err.toString(Charsets.UTF_8), if (process.isAlive) -1 else process.exitValue(), elapsed(), failure)
  }
}

object Compiler {
  val standards = listOf("C++98", "C++11", "C++14", "C++17", "C++20", "C++23", "C++26")
  fun standardFlag(standard: String): String {
    require(standard in standards) { "C++ 标准无效。" }
    return "-std=c++${standard.removePrefix("C++")}"
  }
  fun validate(path: String) {
    val executable = Path.of(path)
    require(executable.isAbsolute && Files.isRegularFile(executable) && Files.isExecutable(executable)) { "请选择存在且可执行的 C++ 编译器文件。" }
    val temp = Files.createTempDirectory("neuoj-compiler-check-")
    try {
      val source = temp.resolve("probe.cpp")
      val binary = temp.resolve(if (System.getProperty("os.name").startsWith("Windows", ignoreCase = true)) "probe.exe" else "probe")
      Files.writeString(source, "#include <iostream>\nint main() { std::cout << 1; }\n")
      val result = Processes.execute(command(path, "C++14", false, source, binary), temp, timeoutMs = 10_000, cancelled = AtomicBoolean())
      require(result.failure == null && result.exitCode == 0 && Files.isRegularFile(binary) && Files.isExecutable(binary)) {
        "所选文件无法编译并链接 C++ 标准库程序。"
      }
    } finally {
      Files.walk(temp).use { paths -> paths.sorted(Comparator.reverseOrder()).forEach { Files.deleteIfExists(it) } }
    }
  }
  fun detect(path: String = System.getenv("PATH") ?: ""): String? {
    val names = if (System.getProperty("os.name").startsWith("Windows", ignoreCase = true))
      listOf("g++.exe", "gcc.exe", "g++", "gcc") else listOf("g++", "gcc")
    val directories = path.split(java.io.File.pathSeparator).filter { it.isNotBlank() }
    for (name in names) for (directory in directories) {
      val candidate = runCatching { Path.of(directory).resolve(name).toAbsolutePath() }.getOrNull() ?: continue
      if (runCatching { validate(candidate.toString()) }.isSuccess) return candidate.toString()
    }
    return null
  }
  fun command(path: String, standard: String, optimize: Boolean, source: Path, binary: Path) =
    listOf(path, standardFlag(standard)) + (if (optimize) listOf("-O2") else emptyList()) +
      listOf("-x", "c++", source.toString(), "-o", binary.toString())
}

data class TestResult(val sampleId: String, val process: ProcessResult)
data class RunResult(val compile: ProcessResult, val tests: List<TestResult>)

class Runner {
  fun run(problem: Problem, source: Path, compiler: String, standard: String, optimize: Boolean, cancelled: AtomicBoolean,
    onRunning: (String) -> Unit = {}, onCompleted: (TestResult) -> Unit = {}): RunResult {
    require(Files.isRegularFile(source)) { "关联的代码文件不存在。" }
    Compiler.validate(compiler)
    val temp = Files.createTempDirectory("neuoj-run-")
    try {
      val binary = temp.resolve("solution")
      val compile = Processes.execute(Compiler.command(compiler, standard, optimize, source, binary), temp, timeoutMs = 30_000, cancelled = cancelled)
      if (compile.failure != null || compile.exitCode != 0) return RunResult(compile, emptyList())
      val results = mutableListOf<TestResult>()
      for (sample in problem.samples) {
        if (cancelled.get()) break
        onRunning(sample.id)
        val result = TestResult(sample.id, Processes.execute(listOf(binary.toString()), temp, sample.input, problem.timeLimitMs ?: 2000, cancelled))
        results.add(result)
        onCompleted(result)
      }
      return RunResult(compile, results)
    } finally {
      Files.walk(temp).use { paths -> paths.sorted(Comparator.reverseOrder()).forEach { Files.deleteIfExists(it) } }
    }
  }
}
