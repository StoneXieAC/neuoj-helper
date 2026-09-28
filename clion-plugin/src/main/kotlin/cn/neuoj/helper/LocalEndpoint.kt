package cn.neuoj.helper

import com.google.gson.Gson
import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import java.util.concurrent.Executors

class NoReceiverException : IllegalStateException()

/** 与 IDE 生命周期分离的协议接收器，供接收适配器使用。 */
class LocalEndpoint(port: Int, private val importer: (Problem) -> Unit) : AutoCloseable {
  private val server = HttpServer.create(InetSocketAddress("127.0.0.1", port), 16)
  private val workers = Executors.newFixedThreadPool(2) { runnable -> Thread(runnable, "NEUOJ 连接").apply { isDaemon = true } }
  val port: Int get() = server.address.port
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
          response = mapOf("protocolVersion" to 1, "capabilities" to listOf("importProblem"), "ide" to "CLion")
        } else if (exchange.requestURI.path == "/v1/problems" && exchange.requestMethod == "POST") {
          require(exchange.requestHeaders.getFirst("Content-Type")?.substringBefore(';') == "application/json") { "需要 JSON 数据。" }
          val bytes = exchange.requestBody.readNBytes(2 * 1024 * 1024 + 1)
          require(bytes.size <= 2 * 1024 * 1024) { "题目数据过大。" }
          val problem = Protocol.parse(String(bytes, Charsets.UTF_8))
          importer(problem)
          response = mapOf("ok" to true, "id" to problem.id)
        } else { code = 404; response = mapOf("error" to "接口不存在。") }
      } catch (_: NoReceiverException) {
        code = 409; response = mapOf("error" to "请在 CLion 中打开并选中本地代码文件。")
      } catch (_: Exception) {
        code = 400; response = mapOf("error" to "导入数据无效或工作区无法写入。")
      }
      try {
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
