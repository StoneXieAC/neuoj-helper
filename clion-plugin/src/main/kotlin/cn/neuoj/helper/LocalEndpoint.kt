package cn.neuoj.helper

import com.google.gson.Gson
import com.google.gson.JsonParser
import com.sun.net.httpserver.HttpServer
import java.net.BindException
import java.net.InetSocketAddress
import java.util.UUID
import java.util.concurrent.Executors

class NoReceiverException : IllegalStateException()
class PortRangeExhaustedException(ports: IntRange) :
  IllegalStateException("本机端口 ${ports.first}–${ports.last} 均被占用，请关闭占用程序后重试。")

internal val BRIDGE_PORTS = 39271..39280

internal fun startLocalEndpoint(ports: IntRange = BRIDGE_PORTS, submissions: SubmissionQueue = SubmissionQueue(),
  importer: (Problem, String) -> Unit): LocalEndpoint {
  for (port in ports) {
    val endpoint = try { LocalEndpoint(port, submissions, importer) }
    catch (_: BindException) { continue }
    try { endpoint.start(); return endpoint }
    catch (error: Exception) { endpoint.close(); throw error }
  }
  throw PortRangeExhaustedException(ports)
}

/** 与 IDE 生命周期分离的协议接收器，供接收适配器使用。 */
class LocalEndpoint(port: Int, private val submissions: SubmissionQueue = SubmissionQueue(),
  private val importer: (Problem, String) -> Unit) : AutoCloseable {
  private val server = HttpServer.create(InetSocketAddress("127.0.0.1", port), 16)
  private val workers = Executors.newFixedThreadPool(4) { runnable -> Thread(runnable, "NEUOJ 连接").apply { isDaemon = true } }
  val port: Int get() = server.address.port
  val instanceId: String = UUID.randomUUID().toString()
  init {
    server.executor = workers
    server.createContext("/v1/") { exchange ->
      var code = 200
      var response: Any
      try {
        require(exchange.requestHeaders.getFirst("Host") == "127.0.0.1:${this.port}") { "请求目标无效。" }
        val origin = exchange.requestHeaders.getFirst("Origin")
        if (origin != null && !origin.startsWith("chrome-extension://") && !origin.startsWith("moz-extension://")) {
          code = 403; response = mapOf("error" to "请求来源无效。")
        } else if (exchange.requestURI.rawQuery != null) {
          code = 400; response = mapOf("error" to "请求地址无效。")
        } else if (exchange.requestURI.path == "/v1/capabilities" && exchange.requestMethod == "GET") {
          response = mapOf("protocolVersion" to 1, "capabilities" to listOf("importProblem", "submitCode"),
            "ide" to "CLion", "service" to "neuoj-ide-bridge", "instanceId" to instanceId)
        } else if (exchange.requestURI.path == "/v1/problems" && exchange.requestMethod == "POST") {
          require(exchange.requestHeaders.getFirst("Content-Type")?.substringBefore(';') == "application/json") { "需要 JSON 数据。" }
          val token = exchange.requestHeaders.getFirst("X-NEUOJ-Pair") ?: ""
          require(Regex("[a-f0-9]{64}").matches(token)) { "配对数据无效。" }
          val bytes = exchange.requestBody.readNBytes(2 * 1024 * 1024 + 1)
          require(bytes.size <= 2 * 1024 * 1024) { "题目数据过大。" }
          val problem = Protocol.parse(String(bytes, Charsets.UTF_8))
          importer(problem, token)
          submissions.register(token, problem.id)
          response = mapOf("ok" to true, "id" to problem.id)
        } else if (exchange.requestURI.path == "/v1/submissions/next" && exchange.requestMethod == "GET") {
          val token = exchange.requestHeaders.getFirst("X-NEUOJ-Pair") ?: ""
          val job = submissions.next(token)
          if (job == null) { code = 204; response = "" }
          else response = job
        } else if (exchange.requestURI.path == "/v1/submissions/results" && exchange.requestMethod == "POST") {
          require(exchange.requestHeaders.getFirst("Content-Type")?.substringBefore(';') == "application/json") { "需要 JSON 数据。" }
          val token = exchange.requestHeaders.getFirst("X-NEUOJ-Pair") ?: ""
          val bytes = exchange.requestBody.readNBytes(8193)
          require(bytes.size <= 8192) { "提交结果过大。" }
          val json = JsonParser.parseString(String(bytes, Charsets.UTF_8)).asJsonObject
          require(json.get("id")?.isJsonPrimitive == true && json.get("ok")?.isJsonPrimitive == true &&
            json.get("ok").asJsonPrimitive.isBoolean) { "提交结果无效。" }
          val result = Gson().fromJson(json, SubmissionResult::class.java)
          submissions.complete(token, result)
          response = mapOf("ok" to true)
        } else { code = 404; response = mapOf("error" to "接口不存在。") }
      } catch (_: NoReceiverException) {
        code = 409; response = mapOf("error" to "请在 CLion 中打开并选中本地代码文件。")
      } catch (_: Exception) {
        code = 400; response = mapOf("error" to "请求数据无效或工作区无法写入。")
      }
      try {
        if (code == 204) { exchange.sendResponseHeaders(204, -1); return@createContext }
        val data = Gson().toJson(response).toByteArray(Charsets.UTF_8)
        exchange.responseHeaders.set("Content-Type", "application/json; charset=utf-8")
        exchange.sendResponseHeaders(code, data.size.toLong())
        exchange.responseBody.use { it.write(data) }
      } finally { exchange.close() }
    }
  }
  fun start() = server.start()
  override fun close() { server.stop(0); workers.shutdownNow() }
}
