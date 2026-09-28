package cn.neuoj.helper

import java.net.URI
import java.util.UUID
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

data class SubmissionJob(val id: String, val problemId: String, val url: String, val language: String, val source: String)
data class SubmissionResult(val id: String = "", val ok: Boolean = false, val url: String? = null, val error: String? = null)
const val SUBMISSION_REVIEW_MESSAGE = "请在 NEUOJ 提交记录中核对提交结果。"
fun needsSubmissionReview(error: String?): Boolean = error.isNullOrBlank() ||
  error == SUBMISSION_REVIEW_MESSAGE || error.contains("结果未知") || error.contains("连接中断")

object SubmissionLinks {
  fun records(problemUrl: String): String? {
    if (Protocol.identity(problemUrl) == null) return null
    val uri = URI(problemUrl)
    val vpn = uri.host == "webvpn.neu.edu.cn"
    val path = if (vpn) uri.path.removePrefix(Protocol.VPN) else uri.path
    val scope = Regex("^/(training|contest|exam)/([0-9]+)/").find(path)
    val recordsPath = when (scope?.groupValues?.get(1)) {
      "training" -> "/training/${scope.groupValues[2]}/status"
      "contest", "exam" -> "/${scope.groupValues[1]}/${scope.groupValues[2]}/submissions"
      else -> "/submissions"
    }
    return "https://${uri.host}${if (vpn) Protocol.VPN else ""}$recordsPath"
  }
}

class SubmissionQueue {
  private data class Session(val problems: MutableSet<String>, val jobs: LinkedBlockingQueue<SubmissionJob>)
  private data class Pending(val token: String, val job: SubmissionJob, val answer: CompletableFuture<SubmissionResult>)
  private val sessions = ConcurrentHashMap<String, Session>()
  private val pending = ConcurrentHashMap<String, Pending>()

  fun register(token: String, problemId: String) {
    require(Regex("[a-f0-9]{64}").matches(token) && problemId.isNotBlank()) { "配对数据无效。" }
    val session = sessions.computeIfAbsent(token) { Session(ConcurrentHashMap.newKeySet(), LinkedBlockingQueue()) }
    session.problems.add(problemId)
  }

  fun enqueue(token: String, problem: Problem, language: String, source: String): CompletableFuture<SubmissionResult> {
    require(sessions[token]?.problems?.contains(problem.id) == true) { "浏览器扩展尚未与此题配对，请重新导入题目。" }
    require(Protocol.identity(problem.url) == problem.id && language in listOf("C", "C++14")) { "提交数据无效。" }
    require(source.isNotBlank() && source.toByteArray(Charsets.UTF_8).size <= 1_048_576) { "源码为空或超过 1 MiB。" }
    val job = SubmissionJob(UUID.randomUUID().toString(), problem.id, problem.url, language, source)
    val answer = CompletableFuture<SubmissionResult>()
    pending[job.id] = Pending(token, job, answer)
    sessions[token]!!.jobs.add(job)
    answer.orTimeout(90, TimeUnit.SECONDS).whenComplete { _, _ ->
      pending.remove(job.id)
      sessions[token]?.jobs?.remove(job)
    }
    return answer
  }

  fun next(token: String, timeoutSeconds: Long = 20): SubmissionJob? {
    val queue = (sessions[token] ?: throw IllegalArgumentException("未配对的扩展。")).jobs
    val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(timeoutSeconds)
    while (true) {
      val remaining = deadline - System.nanoTime()
      if (remaining <= 0) return null
      val job = queue.poll(remaining, TimeUnit.NANOSECONDS) ?: return null
      if (pending.containsKey(job.id)) return job
    }
  }

  fun complete(token: String, result: SubmissionResult) {
    val item = pending[result.id] ?: throw IllegalArgumentException("提交任务不存在。")
    require(item.token == token && (result.error?.length ?: 0) <= 500) { "提交结果无效。" }
    if (result.ok) require(result.url != null && validSubmissionUrl(item.job.url, result.url)) { "提交链接无效。" }
    require(pending.remove(result.id, item)) { "提交任务已处理。" }
    item.answer.complete(result)
  }

  private fun validSubmissionUrl(problemUrl: String, raw: String): Boolean = runCatching {
    val problem = URI(problemUrl)
    val target = URI(raw)
    if (target.scheme != "https" || target.host != problem.host || target.rawUserInfo != null ||
      target.port != -1 || target.rawFragment != null) return false
    var path = target.path
    if (problem.host == "webvpn.neu.edu.cn") {
      if (!path.startsWith("${Protocol.VPN}/")) return false
      path = path.removePrefix(Protocol.VPN)
    }
    Regex("/(?:[a-z]+/[0-9]+/)*submissions?/[0-9]+/?").matches(path)
  }.getOrDefault(false)
}
