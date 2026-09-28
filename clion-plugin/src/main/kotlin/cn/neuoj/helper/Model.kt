package cn.neuoj.helper

import com.google.gson.Gson
import com.google.gson.JsonParser
import java.net.URI
import java.nio.file.Files
import java.nio.file.Path

data class Sample(var id: String = "", var input: String = "", var output: String = "", var custom: Boolean = false,
  var originalInput: String? = null) {
  fun restoreInput() { if (!custom) input = originalInput ?: input }
}

enum class SamplePhase { IDLE, COMPILING, RUNNING, FINISHED, COMPILE_ERROR, CANCELLED }

class SampleRunState {
  val results = mutableMapOf<String, ProcessResult>()
  val phases = mutableMapOf<String, SamplePhase>()
  private val compileDiagnostics = mutableMapOf<String, String>()
  var compileDiagnostic = "尚未编译"
  fun phase(id: String) = phases[id] ?: SamplePhase.IDLE
  fun diagnostic(id: String) = compileDiagnostics[id]
  fun start(ids: List<String>) = ids.forEach {
    results.remove(it); compileDiagnostics.remove(it); phases[it] = SamplePhase.COMPILING
  }
  fun running(id: String) { phases[id] = SamplePhase.RUNNING }
  fun complete(id: String, result: ProcessResult) { results[id] = result; phases[id] = SamplePhase.FINISHED }
  fun compileError(ids: List<String>, diagnostic: String) {
    compileDiagnostic = diagnostic
    ids.forEach { phases[it] = SamplePhase.COMPILE_ERROR; compileDiagnostics[it] = diagnostic }
  }
  fun cancelPending(ids: List<String>) = ids.forEach {
    if (phase(it) == SamplePhase.COMPILING || phase(it) == SamplePhase.RUNNING) phases[it] = SamplePhase.CANCELLED
  }
  fun reset(id: String) { results.remove(id); phases.remove(id); compileDiagnostics.remove(id) }
  fun clear() { results.clear(); phases.clear(); compileDiagnostics.clear(); compileDiagnostic = "尚未编译" }
}
data class Problem(
  var protocolVersion: Int = 1, var id: String = "", var url: String = "", var title: String = "",
  var statement: String = "", var images: List<String> = emptyList(), var timeLimitMs: Long? = null,
  var memoryLimitMb: Long? = null, var samples: MutableList<Sample> = mutableListOf()
)

enum class CompareMode(val label: String) {
  TOKENS("忽略空白"), EXACT("逐字比较");
  fun matches(actual: String, expected: String): Boolean = when (this) {
    TOKENS -> tokens(actual) == tokens(expected)
    EXACT -> actual.replace("\r\n", "\n") == expected.replace("\r\n", "\n")
  }
  private fun tokens(value: String) = value.split(Regex("(?U)\\s+")).filter { it.isNotEmpty() }
}

object Protocol {
  const val VPN = "/https/62304135386136393339346365373340bfebea318fd008d8f60d257088"
  private val pathPattern = Regex("/(?:problems/[A-Za-z0-9]+|training/[0-9]+/part/[0-9]+/problem/[A-Za-z0-9]+|group/[0-9]+/(?:problems|problem)/[A-Za-z0-9]+|(?:contest|exam)/[0-9]+/problem/[A-Za-z0-9]+)/?")
  fun identity(raw: String): String? = runCatching {
    val uri = URI(raw)
    if (uri.scheme != "https" || uri.rawUserInfo != null || uri.port != -1) return null
    val vpn = uri.host == "webvpn.neu.edu.cn"
    var path = uri.rawPath ?: return null
    if (vpn) {
      if (!path.startsWith("$VPN/")) return null
      path = path.removePrefix(VPN)
    } else if (uri.host != "oj.neu.edu.cn") return null
    if (!pathPattern.matches(path)) return null
    (if (vpn) "webvpn:" else "https://oj.neu.edu.cn") + path.trimEnd('/')
  }.getOrNull()
  fun parse(raw: String): Problem {
    val json = JsonParser.parseString(raw).asJsonObject
    require(json.get("protocolVersion")?.toString() == "1") { "协议版本不兼容。" }
    fun stringField(obj: com.google.gson.JsonObject, name: String) {
      val value = obj.get(name)
      require(value != null && value.isJsonPrimitive && value.asJsonPrimitive.isString) { "字段类型无效。" }
    }
    for (field in listOf("id", "url", "title", "statement")) stringField(json, field)
    val samples = json.get("samples")
    require(samples != null && samples.isJsonArray && samples.asJsonArray.size() in 1..100) { "样例无效。" }
    samples.asJsonArray.forEach { element ->
      val sample = element.asJsonObject
      for (field in listOf("id", "input", "output")) stringField(sample, field)
    }
    for (field in listOf("timeLimitMs", "memoryLimitMb")) {
      val value = json.get(field)
      require(value == null || value.isJsonNull || (value.isJsonPrimitive && value.asJsonPrimitive.isNumber && Regex("[0-9]+").matches(value.toString()))) { "资源限制无效。" }
    }
    val images = json.get("images")
    require(images == null || (images.isJsonArray && images.asJsonArray.all { it.isJsonPrimitive && it.asJsonPrimitive.isString })) { "图片地址无效。" }
    return Gson().fromJson(json, Problem::class.java).also { validate(it) }
  }
  fun validate(problem: Problem) {
    require(problem.protocolVersion == 1) { "协议版本不兼容。" }
    require(identity(problem.url) == problem.id && problem.id.isNotEmpty()) { "题目地址无效。" }
    require(problem.title.isNotBlank() && problem.title.length <= 1000 && problem.statement.length <= 1_000_000) { "题面无效。" }
    require(problem.samples.size in 1..100 && problem.samples.map { it.id }.distinct().size == problem.samples.size) { "样例无效。" }
    require(problem.samples.all { it.id.isNotBlank() && it.input.length <= 500_000 && it.output.length <= 500_000 && !it.custom }) { "样例无效。" }
    require(problem.timeLimitMs == null || problem.timeLimitMs!! in 1..300_000) { "时间限制无效。" }
    require(problem.images.size <= 100 && problem.images.all { URI(it).scheme == "https" }) { "图片地址无效。" }
  }
}

class Workspace {
  private val problems = mutableMapOf<String, Problem>()
  private val sources = mutableMapOf<String, Path>()

  @Synchronized fun importProblem(problem: Problem, source: Path): Path {
    Protocol.validate(problem)
    require(Files.isRegularFile(source)) { "请先打开并保存本地代码文件。" }
    val path = source.toAbsolutePath().normalize()
    val previousId = sources.entries.firstOrNull { it.value == path && it.key != problem.id }?.key
    if (previousId != null) { sources.remove(previousId); problems.remove(previousId) }
    val merged = problem.copy(samples = problem.samples.map { it.copy(originalInput = it.input) }.toMutableList())
    problems[problem.id]?.samples?.filter { it.custom }?.forEach { merged.samples.add(it) }
    problems[problem.id] = merged
    sources[problem.id] = path
    return path
  }
  @Synchronized fun save(problem: Problem) { if (sources.containsKey(problem.id)) problems[problem.id] = problem }
  @Synchronized fun load(id: String): Problem? = problems[id]
  @Synchronized fun source(id: String): Path? = sources[id]
  @Synchronized fun list(): List<Problem> = problems.values.sortedBy { it.title }
  @Synchronized fun delete(id: String) { problems.remove(id); sources.remove(id) }
}
