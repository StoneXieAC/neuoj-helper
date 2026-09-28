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
      process.descendants().use { stream -> stream.forEach { children[it.pid()] = it } }
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
    process.descendants().use { descendants -> descendants.toList().asReversed().forEach { it.destroyForcibly() } }
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
    require(executable.isAbsolute && Files.isRegularFile(executable) && Files.isExecutable(executable)) { "请选择存在且可执行的 GNU g++ 文件。" }
    val result = Processes.execute(listOf(path, "-dM", "-E", "-x", "c++", "-"), executable.parent, timeoutMs = 5000, cancelled = AtomicBoolean())
    require(result.failure == null && result.exitCode == 0 && Regex("(?m)^#define __GNUC__ ").containsMatchIn(result.stdout) && !result.stdout.contains("#define __clang__ ")) { "所选编译器不是 GNU g++，请选择 GNU GCC 的 g++ 可执行文件。" }
  }
  fun detect(path: String = System.getenv("PATH") ?: ""): String? {
    val candidate = path.split(java.io.File.pathSeparator).filter { it.isNotBlank() }.map { Path.of(it).resolve("g++").toAbsolutePath() }.firstOrNull { Files.isRegularFile(it) && Files.isExecutable(it) } ?: return null
    return runCatching { validate(candidate.toString()); candidate.toString() }.getOrNull()
  }
  fun command(path: String, standard: String, source: Path, binary: Path) = listOf(path, standardFlag(standard), "-O2", source.toString(), "-o", binary.toString())
}

data class TestResult(val sampleId: String, val process: ProcessResult)
data class RunResult(val compile: ProcessResult, val tests: List<TestResult>)

class Runner {
  fun run(problem: Problem, directory: Path, compiler: String, standard: String, cancelled: AtomicBoolean): RunResult {
    Compiler.validate(compiler)
    val binary = directory.resolve("solution")
    val compile = Processes.execute(Compiler.command(compiler, standard, directory.resolve("main.cpp"), binary), directory, timeoutMs = 30_000, cancelled = cancelled)
    if (compile.failure != null || compile.exitCode != 0) return RunResult(compile, emptyList())
    val results = mutableListOf<TestResult>()
    for (sample in problem.samples) {
      if (cancelled.get()) break
      results.add(TestResult(sample.id, Processes.execute(listOf(binary.toString()), directory, sample.input, problem.timeLimitMs ?: 2000, cancelled)))
    }
    return RunResult(compile, results)
  }
}
