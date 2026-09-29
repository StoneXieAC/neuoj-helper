package cn.neuoj.helper

import com.google.gson.Gson
import org.junit.Assert.*
import org.junit.Test
import java.net.URI
import java.net.InetAddress
import java.net.ServerSocket
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.nio.file.Files
import java.time.Duration

class EndpointTest {
  @Test fun httpImportAndFailures() {
    val root = Files.createTempDirectory("neuoj-endpoint-test")
    try {
      val workspace = Workspace()
      val source = root.resolve("current.cpp")
      Files.writeString(source, "用户代码")
      var receiving = true
      val token = "a".repeat(64)
      val submissions = SubmissionQueue()
      LocalEndpoint(0, submissions) { problem, _ -> if (!receiving) throw NoReceiverException(); workspace.importProblem(problem, source) }.use { endpoint ->
        endpoint.start()
        val client = HttpClient.newHttpClient()
        fun request(path: String, body: String? = null, origin: String? = null, pair: String = token): HttpResponse<String> {
          val builder = HttpRequest.newBuilder(URI("http://127.0.0.1:${endpoint.port}/v1/$path"))
            .timeout(Duration.ofSeconds(5))
          if (origin != null) builder.header("Origin", origin)
          builder.header("X-NEUOJ-Pair", pair)
          if (body != null) builder.header("Content-Type", "application/json").POST(HttpRequest.BodyPublishers.ofString(body))
          return client.send(builder.build(), HttpResponse.BodyHandlers.ofString())
        }
        assertEquals(403, request("capabilities", origin = "https://evil.example").statusCode())
        assertEquals(200, request("capabilities", origin = "chrome-extension://abcdef").statusCode())
        assertEquals(200, request("capabilities").statusCode())
        assertTrue(request("capabilities").body().contains("importProblem"))
        val capabilities = com.google.gson.JsonParser.parseString(request("capabilities").body()).asJsonObject
        assertEquals("neuoj-ide-bridge", capabilities.get("service").asString)
        assertEquals(endpoint.instanceId, capabilities.get("instanceId").asString)
        java.net.Socket("127.0.0.1", endpoint.port).use { socket ->
          socket.getOutputStream().write("GET /v1/capabilities HTTP/1.1\r\nHost: 127.0.0.1:27121\r\nConnection: close\r\n\r\n".toByteArray())
          val statusLine = socket.getInputStream().bufferedReader().readLine()
          assertTrue(statusLine.contains("400"))
        }
        assertEquals(404, request("missing").statusCode())
        assertEquals(400, request("problems", "null").statusCode())
        assertEquals(400, request("problems", "{").statusCode())
        assertEquals(400, request("problems", "x".repeat(2 * 1024 * 1024 + 1)).statusCode())
        val p = Problem(id = "https://oj.neu.edu.cn/problems/83", url = "https://oj.neu.edu.cn/problems/83", title = "测试题", statement = "题面", samples = mutableListOf(Sample("official-1", "1\n", "1\n")))
        val body = Gson().toJson(p)
        assertEquals(400, request("problems", body.replace("\"input\":\"1\\n\"", "\"input\":42")).statusCode())
        assertEquals(200, request("problems", body).statusCode())
        val answer = submissions.enqueue(token, p, "C++14", "int main(){}")
        assertEquals(400, request("submissions/next", pair = "b".repeat(64)).statusCode())
        val next = request("submissions/next")
        assertEquals(200, next.statusCode())
        val job = com.google.gson.JsonParser.parseString(next.body()).asJsonObject
        assertEquals("int main(){}", job.get("source").asString)
        val result = Gson().toJson(SubmissionResult(job.get("id").asString, true, "https://oj.neu.edu.cn/submissions/123"))
        assertEquals(200, request("submissions/results", result).statusCode())
        assertTrue(answer.get().ok)
        assertEquals(source, workspace.source(p.id))
        assertEquals(listOf(source), Files.list(root).use { it.toList() })
        receiving = false
        assertEquals(409, request("problems", body).statusCode())
        assertEquals(400, request("problems", Gson().toJson(p.copy(protocolVersion = 2))).statusCode())
        assertEquals(400, request("capabilities?q=1").statusCode())
      }
    } finally { root.toFile().deleteRecursively() }
  }

  @Test fun selectsFirstFreePortAndReportsExhaustion() {
    val address = InetAddress.getByName("127.0.0.1")
    val preferred = ServerSocket(0, 1, address).use { it.localPort }
    startLocalEndpoint(preferred..preferred) { _, _ -> }.use { endpoint ->
      assertEquals(preferred, endpoint.port)
      assertThrows(PortRangeExhaustedException::class.java) {
        startLocalEndpoint(preferred..preferred) { _, _ -> }
      }
    }
    val occupied = ServerSocket(0, 1, address)
    try {
      val next = occupied.localPort + 1
      if (next <= 65535) {
        startLocalEndpoint(occupied.localPort..next) { _, _ -> }.use { endpoint ->
          assertEquals(next, endpoint.port)
          val client = HttpClient.newHttpClient()
          val response = client.send(HttpRequest.newBuilder(URI("http://127.0.0.1:$next/v1/capabilities")).build(),
            HttpResponse.BodyHandlers.ofString())
          assertEquals(200, response.statusCode())
          assertTrue(response.body().contains("neuoj-ide-bridge"))
        }
      }
    } finally { occupied.close() }
  }
}
