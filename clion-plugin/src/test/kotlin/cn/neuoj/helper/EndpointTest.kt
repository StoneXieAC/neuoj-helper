package cn.neuoj.helper

import com.google.gson.Gson
import org.junit.Assert.*
import org.junit.Test
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.nio.file.Files
import java.time.Duration

class EndpointTest {
  @Test fun httpImportAndFailures() {
    val root = Files.createTempDirectory("neuoj-endpoint-test")
    try {
      val workspace = Workspace(root)
      var receiving = true
      LocalEndpoint(0) { if (!receiving) throw NoReceiverException(); workspace.importProblem(it) }.use { endpoint ->
        endpoint.start()
        val client = HttpClient.newHttpClient()
        fun request(path: String, body: String? = null, origin: String? = null): HttpResponse<String> {
          val builder = HttpRequest.newBuilder(URI("http://127.0.0.1:${endpoint.port}/v1/$path"))
            .timeout(Duration.ofSeconds(5))
          if (origin != null) builder.header("Origin", origin)
          if (body != null) builder.header("Content-Type", "application/json").POST(HttpRequest.BodyPublishers.ofString(body))
          return client.send(builder.build(), HttpResponse.BodyHandlers.ofString())
        }
        assertEquals(403, request("capabilities", origin = "https://evil.example").statusCode())
        assertEquals(200, request("capabilities", origin = "chrome-extension://abcdef").statusCode())
        assertEquals(200, request("capabilities").statusCode())
        assertTrue(request("capabilities").body().contains("importProblem"))
        assertEquals(404, request("missing").statusCode())
        assertEquals(400, request("problems", "null").statusCode())
        assertEquals(400, request("problems", "{").statusCode())
        assertEquals(400, request("problems", "x".repeat(2 * 1024 * 1024 + 1)).statusCode())
        val p = Problem(id = "https://oj.neu.edu.cn/problems/83", url = "https://oj.neu.edu.cn/problems/83", title = "测试题", statement = "题面", samples = mutableListOf(Sample("official-1", "1\n", "1\n")))
        val body = Gson().toJson(p)
        assertEquals(400, request("problems", body.replace("\"input\":\"1\\n\"", "\"input\":42")).statusCode())
        assertEquals(200, request("problems", body).statusCode())
        assertTrue(Files.exists(workspace.directory(p.id).resolve("main.cpp")))
        receiving = false
        assertEquals(409, request("problems", body).statusCode())
        assertEquals(400, request("problems", Gson().toJson(p.copy(protocolVersion = 2))).statusCode())
        assertEquals(400, request("capabilities?q=1").statusCode())
      }
    } finally { root.toFile().deleteRecursively() }
  }
}
