package cn.neuoj.helper

import java.io.ByteArrayOutputStream
import java.io.IOException
import java.nio.file.Files
import java.nio.file.Path
import java.util.UUID
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import kotlin.concurrent.thread

data class ProcessResult(val stdout: String, val stderr: String, val exitCode: Int, val elapsedMs: Long,
  val failure: String? = null, val cpuTimeMicros: Long? = null, val sampleWallTimeMicros: Long? = null)

internal object NativeCpuTimer {
  data class Measurement(val exitCode: Int?, val cpuTimeMicros: Long?, val wallTimeMicros: Long?,
    val spawnError: Int?, val timedOut: Boolean = false)

  internal fun resourcePath(os: String = System.getProperty("os.name"), arch: String = System.getProperty("os.arch")): String? {
    if (os.startsWith("Mac", ignoreCase = true)) return "/native/macos/neuoj-time"
    if (arch != "amd64" && arch != "x86_64") return null
    return when {
      os.startsWith("Linux", ignoreCase = true) -> "/native/linux-x64/neuoj-time"
      os.startsWith("Windows", ignoreCase = true) -> "/native/windows-x64/neuoj-time.exe"
      else -> null
    }
  }

  fun prepare(cwd: Path, path: String? = resourcePath()): Path? {
    if (path == null) return null
    val resource = NativeCpuTimer::class.java.getResourceAsStream(path) ?: return null
    var binary: Path? = null
    return try {
      resource.use {
        binary = Files.createTempFile(cwd, "neuoj-time-", if (path.endsWith(".exe")) ".exe" else "")
        Files.copy(it, binary!!, java.nio.file.StandardCopyOption.REPLACE_EXISTING)
      }
      if (!path.endsWith(".exe") && !binary!!.toFile().setExecutable(true, true)) throw IOException("无法运行计时辅助程序")
      binary
    } catch (_: Exception) {
      binary?.let { runCatching { Files.deleteIfExists(it) } }
      null
    }
  }

  fun read(path: Path): Measurement? = runCatching {
    if (Files.size(path) > 128) return null
    val lines = Files.readAllLines(path, Charsets.US_ASCII)
    if (lines.size != 4 || lines[0] != "neuoj-time-v2") return null
    val state = lines[1].substringBefore('=')
    val value = lines[1].substringAfter('=', "").toLongOrNull() ?: return null
    val cpu = lines[2].removePrefix("cpu_us=").takeIf { lines[2].startsWith("cpu_us=") }?.toLongOrNull() ?: return null
    val wall = lines[3].removePrefix("wall_us=").takeIf { lines[3].startsWith("wall_us=") }?.toLongOrNull() ?: return null
    if (value < 0 || cpu < 0 || wall < 0) return null
    when (state) {
      "exit" -> if (value <= 0xffffffffL) Measurement(value.toInt(), cpu, wall, null) else null
      "signal" -> if (value in 1..127) Measurement((128 + value).toInt(), cpu, wall, null) else null
      "timeout" -> if (value <= 0xffffffffL) Measurement(value.toInt(), cpu, wall, null, timedOut = true) else null
      "spawn_error" -> if (value <= Int.MAX_VALUE) Measurement(null, null, null, value.toInt()) else null
      else -> null
    }
  }.getOrNull()
}

fun formatRunTime(result: ProcessResult): String {
  val cpu = result.cpuTimeMicros ?: return "用时不可用"
  return "用时 ${if (cpu < 1000) "<1" else (cpu / 1000).toString()} ms"
}

object Processes {
  fun execute(args: List<String>, cwd: Path, input: String = "", timeoutMs: Long, cancelled: AtomicBoolean,
    maxBytes: Long = 1_048_576, measureCpu: Boolean = false): ProcessResult {
    if (cancelled.get()) return ProcessResult("", "", -1, 0, "已取消")
    val helper = if (measureCpu) NativeCpuTimer.prepare(cwd) else null
    val metadata = helper?.let { cwd.resolve("neuoj-time-${UUID.randomUUID()}.result") }
    val command = if (helper != null) listOf(helper.toString(), metadata.toString(), timeoutMs.toString()) + args else args
    val process = try { ProcessBuilder(command).directory(cwd.toFile()).start() }
    catch (error: IOException) {
      if (helper == null) throw error
      runCatching { Files.deleteIfExists(helper) }
      return execute(args, cwd, input, timeoutMs, cancelled, maxBytes)
    }
    val started = System.nanoTime()
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
    var finishedAt: Long? = null
    val children = mutableMapOf<Long, ProcessHandle>()
    fun timedOut(at: Long) = at - started >= TimeUnit.MILLISECONDS.toNanos(timeoutMs)
    while (true) {
      if (process.waitFor(10, TimeUnit.MILLISECONDS)) {
        val observedAt = System.nanoTime()
        finishedAt = observedAt
        if (helper == null && timedOut(observedAt)) failure = "超时"
        break
      }
      runCatching { process.descendants().use { stream -> stream.forEach { children[it.pid()] = it } } }
      if (process.waitFor(0, TimeUnit.MILLISECONDS)) {
        val observedAt = System.nanoTime()
        finishedAt = observedAt
        if (helper == null && timedOut(observedAt)) failure = "超时"
        break
      }
      val checkedAt = System.nanoTime()
      failure = when {
        cancelled.get() -> "已取消"
        exceeded.get() -> "输出超限"
        helper == null && timedOut(checkedAt) -> "超时"
        helper != null && checkedAt - started >= TimeUnit.MILLISECONDS.toNanos(timeoutMs + 2000) -> "计时失败"
        else -> null
      }
      if (failure != null) {
        finishedAt = System.nanoTime()
        break
      }
    }
    val endedAt = checkNotNull(finishedAt)
    if (failure == null && exceeded.get()) failure = "输出超限"
    // 子进程可能继承管道；结束时一并清理，避免孤儿进程或阻塞读取。
    runCatching { process.descendants().use { descendants -> descendants.toList().asReversed().forEach { it.destroyForcibly() } } }
    children.values.toList().asReversed().forEach { if (it.isAlive) it.destroyForcibly() }
    if (process.isAlive) {
      if (helper != null) {
        process.destroy()
        if (!process.waitFor(200, TimeUnit.MILLISECONDS)) process.destroyForcibly()
      } else process.destroyForcibly()
    }
    process.waitFor(2, TimeUnit.SECONDS)
    writer.join(1000); stdout.join(1000); stderr.join(1000)
    process.inputStream.close(); process.errorStream.close()
    if (exceeded.get() && failure == null) failure = "输出超限"
    val measurement = metadata?.let { NativeCpuTimer.read(it) }
    if (helper != null) runCatching { Files.deleteIfExists(helper) }
    if (metadata != null) runCatching { Files.deleteIfExists(metadata) }
    if (helper != null && failure == null) {
      failure = when {
        measurement == null -> "计时失败"
        measurement.spawnError != null -> "无法启动程序（系统错误码 ${measurement.spawnError}）"
        measurement.timedOut -> "超时"
        else -> null
      }
    }
    return ProcessResult(out.toString(Charsets.UTF_8), err.toString(Charsets.UTF_8),
      measurement?.exitCode ?: if (process.isAlive) -1 else process.exitValue(),
      (endedAt - started) / 1_000_000, failure, measurement?.cpuTimeMicros, measurement?.wallTimeMicros)
  }
}

object Compiler {
  val standards = listOf("C89", "C99", "C11", "C17", "C23", "C++98", "C++11", "C++14", "C++17", "C++20", "C++23", "C++26")
  fun language(standard: String): String {
    require(standard in standards) { "语言标准无效。" }
    return if (standard.startsWith("C++")) "C++14" else "C"
  }
  fun extraArguments(value: String): List<String> {
    require('\n' !in value && '\r' !in value) { "编译参数只能填写一行。" }
    val result = mutableListOf<String>()
    val current = StringBuilder()
    var quote: Char? = null
    var started = false
    var index = 0
    while (index < value.length) {
      val char = value[index]
      when {
        char == '\\' && quote != '\'' && index + 1 < value.length &&
          (value[index + 1].isWhitespace() || value[index + 1] == '"' ||
            value[index + 1] == '\'' || value[index + 1] == '\\') -> {
          current.append(value[index + 1]); started = true; index++
        }
        char == '\'' || char == '"' -> {
          if (quote == null) { quote = char; started = true }
          else if (quote == char) quote = null
          else current.append(char)
        }
        char.isWhitespace() && quote == null -> {
          if (started) { result.add(current.toString()); current.clear(); started = false }
        }
        else -> { current.append(char); started = true }
      }
      index++
    }
    require(quote == null) { "编译参数中的引号未闭合。" }
    if (started) result.add(current.toString())
    return result
  }
  fun standardFlag(standard: String): String {
    require(standard in standards) { "语言标准无效。" }
    return if (standard.startsWith("C++")) "-std=c++${standard.removePrefix("C++")}" else "-std=c${standard.removePrefix("C")}"
  }
  fun validate(path: String, standard: String = "C++14") {
    val executable = Path.of(path)
    require(executable.isAbsolute && Files.isRegularFile(executable) && Files.isExecutable(executable)) { "请选择存在且可执行的编译器文件。" }
    val temp = Files.createTempDirectory("neuoj-compiler-check-")
    try {
      val source = temp.resolve(if (language(standard) == "C") "probe.c" else "probe.cpp")
      val binary = temp.resolve(if (System.getProperty("os.name").startsWith("Windows", ignoreCase = true)) "probe.exe" else "probe")
      Files.writeString(source, if (language(standard) == "C") "#include <stdio.h>\nint main(void) { puts(\"1\"); return 0; }\n"
        else "#include <iostream>\nint main() { std::cout << 1; }\n")
      val result = Processes.execute(command(path, standard, false, source, binary), temp, timeoutMs = 10_000, cancelled = AtomicBoolean())
      require(result.failure == null && result.exitCode == 0 && Files.isRegularFile(binary) && Files.isExecutable(binary)) {
        "所选编译器不支持 $standard 或无法完成链接。"
      }
    } finally {
      Files.walk(temp).use { paths -> paths.sorted(Comparator.reverseOrder()).forEach { Files.deleteIfExists(it) } }
    }
  }
  fun detect(path: String = System.getenv("PATH") ?: "", standard: String = "C++14"): String? {
    val baseNames = if (language(standard) == "C") listOf("gcc", "clang", "g++", "clang++") else listOf("g++", "clang++", "gcc", "clang")
    val names = if (System.getProperty("os.name").startsWith("Windows", ignoreCase = true))
      baseNames.map { "$it.exe" } + baseNames else baseNames
    val directories = path.split(java.io.File.pathSeparator).filter { it.isNotBlank() }
    for (name in names) for (directory in directories) {
      val candidate = runCatching { Path.of(directory).resolve(name).toAbsolutePath() }.getOrNull() ?: continue
      if (runCatching { validate(candidate.toString(), standard) }.isSuccess) return candidate.toString()
    }
    return null
  }
  fun command(path: String, standard: String, optimize: Boolean, source: Path, binary: Path, extra: String = "") =
    listOf(path, standardFlag(standard)) + (if (optimize) listOf("-O2") else emptyList()) +
      listOf("-x", if (language(standard) == "C") "c" else "c++", source.toString(), "-o", binary.toString()) + extraArguments(extra)
}

data class TestResult(val sampleId: String, val process: ProcessResult)
data class RunResult(val compile: ProcessResult, val tests: List<TestResult>)

class Runner {
  fun run(problem: Problem, source: Path, compiler: String, standard: String, optimize: Boolean, cancelled: AtomicBoolean,
    extraArguments: String = "",
    onRunning: (String) -> Unit = {}, onCompleted: (TestResult) -> Unit = {}): RunResult {
    require(Files.isRegularFile(source)) { "关联的代码文件不存在。" }
    Compiler.validate(compiler, standard)
    val temp = Files.createTempDirectory("neuoj-run-")
    try {
      val binary = temp.resolve(if (System.getProperty("os.name").startsWith("Windows", ignoreCase = true)) "solution.exe" else "solution")
      val compile = Processes.execute(Compiler.command(compiler, standard, optimize, source, binary, extraArguments), temp, timeoutMs = 30_000, cancelled = cancelled)
      if (compile.failure != null || compile.exitCode != 0) return RunResult(compile, emptyList())
      val results = mutableListOf<TestResult>()
      for (sample in problem.samples) {
        if (cancelled.get()) break
        onRunning(sample.id)
        val result = TestResult(sample.id, Processes.execute(listOf(binary.toString()), temp, sample.input,
          problem.timeLimitMs ?: 2000, cancelled, measureCpu = true))
        results.add(result)
        onCompleted(result)
      }
      return RunResult(compile, results)
    } finally {
      Files.walk(temp).use { paths -> paths.sorted(Comparator.reverseOrder()).forEach { Files.deleteIfExists(it) } }
    }
  }
}
