package cn.neuoj.helper

import com.intellij.util.SVGLoader
import org.junit.Assert.*
import org.junit.Assume.assumeFalse
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.nio.file.Files
import java.nio.file.Path
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import java.awt.Dimension
import java.awt.image.BufferedImage
import java.awt.event.MouseEvent
import java.awt.event.MouseWheelEvent
import javax.swing.JPanel
import javax.swing.JScrollPane
import javax.swing.JTextArea
import javax.swing.JButton
import javax.swing.JLabel

class CoreTest {
  private fun problem() = Problem(id = "https://oj.neu.edu.cn/problems/83", url = "https://oj.neu.edu.cn/problems/83", title = "测试题目", statement = "题面", samples = mutableListOf(Sample("official-1", "1\n", "1\n")))
  private fun processProbe(root: Path): List<String> {
    val binary = if (System.getProperty("os.name").startsWith("Windows")) ".exe" else ""
    val javaHome = Path.of(System.getProperty("java.home"), "bin")
    val source = root.resolve("ProcessProbe.java")
    Files.writeString(source, """
      public class ProcessProbe {
        public static void main(String[] args) throws Exception {
          switch (args[0]) {
            case "echo" -> System.in.transferTo(System.out);
            case "fail" -> { System.err.println("diagnostic"); System.exit(7); }
            case "sleep" -> Thread.sleep(Long.parseLong(args[1]));
            case "busy" -> { double value = 0;
              for (int i = 0; i < 50_000_000; i++) value += Math.sqrt(i);
              System.err.println(value); }
            case "spam" -> { byte[] bytes = new byte[8192]; java.util.Arrays.fill(bytes, (byte) 'x');
              for (int i = 0; i < 1000; i++) System.out.write(bytes); }
          }
        }
      }
    """.trimIndent())
    val compiler = ProcessBuilder(javaHome.resolve("javac$binary").toString(), source.toString()).start()
    assertEquals(String(compiler.errorStream.readAllBytes()), 0, compiler.waitFor())
    return listOf(javaHome.resolve("java$binary").toString(), "-cp", root.toString(), "ProcessProbe")
  }
  @Test fun pluginLogoLoadsAndPaints() {
    assertNotNull(javaClass.getResource("/META-INF/pluginIcon.svg"))
    val image = SVGLoader.load(javaClass.getResource("/META-INF/pluginIcon.svg")!!, 1f) as BufferedImage
    assertEquals(40, image.width)
    assertEquals(40, image.height)
    assertTrue(image.getRGB(20, 20) ushr 24 > 0)
  }
  @Test fun submissionRecordLinksStayInTheImportedEntry() {
    val vpn = "https://webvpn.neu.edu.cn${Protocol.VPN}"
    assertEquals("https://oj.neu.edu.cn/submissions", SubmissionLinks.records("https://oj.neu.edu.cn/problems/83"))
    assertEquals("https://oj.neu.edu.cn/training/1/status", SubmissionLinks.records("https://oj.neu.edu.cn/training/1/part/4/problem/9"))
    assertEquals("https://oj.neu.edu.cn/contest/162/submissions", SubmissionLinks.records("https://oj.neu.edu.cn/contest/162/problem/A"))
    assertEquals("$vpn/exam/46/submissions", SubmissionLinks.records("$vpn/exam/46/problem/F"))
    assertEquals("$vpn/training/1/status", SubmissionLinks.records("$vpn/training/1/part/4/problem/9?tab=answer"))
    assertNull(SubmissionLinks.records("https://webvpn.neu.edu.cn/https/other/exam/46/problem/F"))
    assertNull(SubmissionLinks.records("https://evil.example/problems/83"))
  }
  @Test fun submissionReviewCopyDistinguishesUnverifiedAndDefiniteErrors() {
    assertEquals("请在 NEUOJ 提交记录中核对提交结果。", SUBMISSION_REVIEW_MESSAGE)
    assertTrue(needsSubmissionReview(null))
    assertTrue(needsSubmissionReview(SUBMISSION_REVIEW_MESSAGE))
    assertTrue(needsSubmissionReview("连接中断"))
    assertFalse(needsSubmissionReview("提交令牌或语言选项缺失。"))
  }
  @Test fun comparison() {
    assertTrue(CompareMode.TOKENS.matches(" 1\t23\n", "1 23"))
    assertFalse(CompareMode.TOKENS.matches("1 23", "12 3"))
    assertTrue(CompareMode.TOKENS.matches("\u20031\u00a023", "1 23"))
    assertTrue(CompareMode.EXACT.matches("a\r\n", "a\n"))
    assertFalse(CompareMode.EXACT.matches("a\n", "a"))
    assertFalse(CompareMode.EXACT.matches("a \n", "a\n"))
    assertFalse(CompareMode.EXACT.matches("a\r", "a"))
    val output = "1  23\n"
    assertTrue(CompareMode.TOKENS.matches(output, "1 23\n"))
    assertFalse(CompareMode.EXACT.matches(output, "1 23\n"))
  }
  @Test fun lineComparisonFollowsSelectedMode() {
    val exact = OutputComparison.compare("alpha\nbeta\ngamma", "alpha\nwrong\ngamma", CompareMode.EXACT)
    assertEquals(listOf(true, false, true), exact.expected)
    assertEquals(listOf(true, false, true), exact.actual)
    val missing = OutputComparison.compare("alpha\nbeta\ngamma", "alpha\ngamma", CompareMode.EXACT)
    assertEquals(listOf(true, false, true), missing.expected)
    assertEquals(listOf(true, true), missing.actual)
    assertEquals(listOf(2), missing.missingActual)
    assertEquals(emptyList<Int>(), missing.missingExpected)
    val extra = OutputComparison.compare("alpha\ngamma", "alpha\nbeta\ngamma", CompareMode.EXACT)
    assertEquals(listOf(2), extra.missingExpected)
    assertEquals(listOf(true, false, true), extra.actual)
    val whitespace = OutputComparison.compare("a b\n", "a\n\nb", CompareMode.TOKENS)
    assertTrue(CompareMode.TOKENS.matches("a\n\nb", "a b\n"))
    assertTrue(whitespace.expected.all { it } && whitespace.actual.all { it })
    val missingTokenLine = OutputComparison.compare("a\nb\nc", "a\nc", CompareMode.TOKENS)
    assertEquals(listOf(2), missingTokenLine.missingActual)
    assertEquals(listOf(true, true), missingTokenLine.actual)
    assertEquals(listOf(2), OutputComparison.compare("a\nc", "a\nb\nc", CompareMode.TOKENS).missingExpected)
    val extraToken = OutputComparison.compare("a b", "a x b", CompareMode.TOKENS)
    assertEquals(emptyList<Int>(), extraToken.missingExpected)
    assertEquals(listOf(false), extraToken.expected)
    assertEquals(listOf(false), extraToken.actual)
    val deletedToken = OutputComparison.compare("a x b", "a b", CompareMode.TOKENS)
    assertEquals(emptyList<Int>(), deletedToken.missingActual)
    assertEquals(listOf(false), deletedToken.expected)
    assertEquals(listOf(false), deletedToken.actual)
    assertEquals(listOf(false, true), OutputComparison.compare("a x\nb", "a\nb", CompareMode.TOKENS).actual)
    assertEquals(listOf(true, false), OutputComparison.compare("a\nx b", "a\nb", CompareMode.TOKENS).actual)
    assertEquals(listOf(false, true), OutputComparison.compare("a\nb", "x\nb", CompareMode.TOKENS).actual)
    assertEquals(listOf(true), OutputComparison.compare("", "", CompareMode.EXACT).actual)
    assertEquals(listOf(false), OutputComparison.compare("", "x", CompareMode.EXACT).actual)
    assertTrue(OutputComparison.compare("a\r\nb", "a\nb", CompareMode.EXACT).actual.all { it })
    assertEquals(listOf(false, true), OutputComparison.compare("a \nb", "a\nb", CompareMode.EXACT).expected)
  }
  @Test fun cardMarginsRemainScrollable() {
    val card = JPanel()
    val row = CardRow(card)
    row.setSize(1000, 100); row.doLayout()
    assertEquals(840, card.width); assertEquals(80, card.x)
    row.setSize(700, 100); row.doLayout()
    assertEquals(652, card.width); assertEquals(24, card.x)
    row.setSize(400, 100); row.doLayout()
    assertEquals(384, card.width); assertEquals(8, card.x)
  }
  @Test fun submissionBannerMatchesTestCaseWidthWithScrollbar() {
    for (width in listOf(400, 700, 1000)) {
      val testCase = JPanel().apply { preferredSize = Dimension(100, 30) }
      val banner = JPanel().apply { preferredSize = Dimension(100, 30) }
      CardRow(testCase).apply { setSize(width - 16, 30); doLayout() }
      CardRow(banner) { 16 }.apply { setSize(width, 30); doLayout() }
      assertEquals(testCase.x, banner.x)
      assertEquals(testCase.width, banner.width)
    }
  }
  @Test fun wheelOnNonScrollableFieldMovesOuterCards() {
    val longPanel = JPanel().apply { preferredSize = Dimension(100, 1000) }
    val outer = JScrollPane(longPanel).apply { setSize(100, 100); doLayout(); verticalScrollBar.unitIncrement = 18 }
    val inner = ForwardingScrollPane(JTextArea("短文本"), { outer }).apply { setSize(100, 80); doLayout() }
    val event = MouseWheelEvent(inner, MouseEvent.MOUSE_WHEEL, System.currentTimeMillis(), 0,
      10, 10, 0, false, MouseWheelEvent.WHEEL_UNIT_SCROLL, 3, 1)
    inner.dispatchEvent(event)
    assertTrue(outer.verticalScrollBar.value > 0)
  }
  @Test fun blankClickReleasesEditorWheelControl() {
    val outer = JScrollPane(JPanel().apply { preferredSize = Dimension(100, 1000) }).apply {
      setSize(100, 100); doLayout(); verticalScrollBar.unitIncrement = 18
    }
    var editorActive = true
    val area = JTextArea((1..100).joinToString("\n"))
    val inner = ForwardingScrollPane(area, { outer }) { editorActive }.apply { setSize(100, 80); doLayout() }
    val blank = JPanel()
    val label = JLabel("输入")
    val button = JButton("运行")
    val root = JPanel().apply { add(blank); add(label); add(button); add(inner) }
    var blankClicks = 0
    installBlankClickHandler(root) { editorActive = false; blankClicks++ }
    fun click(component: java.awt.Component) = component.dispatchEvent(MouseEvent(component,
      MouseEvent.MOUSE_PRESSED, System.currentTimeMillis(), 0, 2, 2, 1, false))
    fun wheel() = inner.dispatchEvent(MouseWheelEvent(inner, MouseEvent.MOUSE_WHEEL,
      System.currentTimeMillis(), 0, 10, 10, 0, false, MouseWheelEvent.WHEEL_UNIT_SCROLL, 3, 1))
    click(area)
    assertTrue(editorActive)
    wheel()
    assertTrue(inner.verticalScrollBar.value > 0)
    assertEquals(0, outer.verticalScrollBar.value)
    val innerPosition = inner.verticalScrollBar.value
    click(blank)
    assertFalse(editorActive)
    wheel()
    assertEquals(innerPosition, inner.verticalScrollBar.value)
    assertTrue(outer.verticalScrollBar.value > 0)
    click(label); click(button)
    assertEquals(3, blankClicks)
    installBlankClickHandler(root) { blankClicks++ }
    click(blank)
    assertEquals(4, blankClicks)
  }
  @Test fun protocol() {
    val p = problem(); Protocol.validate(p)
    val vpn = "https://webvpn.neu.edu.cn${Protocol.VPN}/exam/46/problem/F?q=1#fragment"
    assertEquals("webvpn:/exam/46/problem/F", Protocol.identity(vpn))
    assertNull(Protocol.identity("https://webvpn.neu.edu.cn/https/other/exam/46/problem/F"))
    assertNull(Protocol.identity("https://user@oj.neu.edu.cn/problems/83"))
    assertNull(Protocol.identity("http://oj.neu.edu.cn/problems/83"))
    assertNull(Protocol.identity("https://oj.neu.edu.cn/problems/../83"))
    assertThrows(IllegalArgumentException::class.java) { Protocol.validate(p.copy(protocolVersion = 2)) }
    assertThrows(IllegalArgumentException::class.java) { Protocol.validate(p.copy(samples = mutableListOf())) }
    assertThrows(IllegalArgumentException::class.java) { Protocol.validate(p.copy(id = "../escape")) }
  }
  @Test fun pairedSubmissionQueue() {
    val queue = SubmissionQueue()
    val token = "a".repeat(64)
    val other = "b".repeat(64)
    val p = problem()
    assertThrows(IllegalArgumentException::class.java) { queue.register("short", p.id) }
    queue.register(token, p.id)
    assertThrows(IllegalArgumentException::class.java) { queue.enqueue(other, p, "C++14", "int main(){}") }
    assertThrows(IllegalArgumentException::class.java) { queue.enqueue(token, p, "C++98", "int main(){}") }
    assertThrows(IllegalArgumentException::class.java) { queue.enqueue(token, p, "C", " ") }
    val answer = queue.enqueue(token, p, "C++14", "int main(){}")
    assertThrows(IllegalArgumentException::class.java) { queue.next(other, 1) }
    val job = queue.next(token, 1)!!
    assertEquals(p.id, job.problemId)
    assertEquals("int main(){}", job.source)
    assertThrows(IllegalArgumentException::class.java) {
      queue.complete(other, SubmissionResult(job.id, true, "https://oj.neu.edu.cn/submissions/123"))
    }
    assertThrows(IllegalArgumentException::class.java) {
      queue.complete(token, SubmissionResult(job.id, true, "https://evil.example/submissions/123"))
    }
    queue.complete(token, SubmissionResult(job.id, true, "https://oj.neu.edu.cn/submissions/123"))
    assertTrue(answer.get().ok)
    assertThrows(IllegalArgumentException::class.java) {
      queue.complete(token, SubmissionResult(job.id, true, "https://oj.neu.edu.cn/submissions/123"))
    }
    val vpn = p.copy(id = "webvpn:/exam/46/problem/F", url = "https://webvpn.neu.edu.cn${Protocol.VPN}/exam/46/problem/F")
    queue.register(token, vpn.id)
    val vpnAnswer = queue.enqueue(token, vpn, "C", "int main(void){}")
    val vpnJob = queue.next(token, 1)!!
    assertThrows(IllegalArgumentException::class.java) {
      queue.complete(token, SubmissionResult(vpnJob.id, true, "https://webvpn.neu.edu.cn/https/other/submissions/9"))
    }
    queue.complete(token, SubmissionResult(vpnJob.id, true, "https://webvpn.neu.edu.cn${Protocol.VPN}/exam/46/submissions/9"))
    assertTrue(vpnAnswer.get().ok)
  }
  @Test fun workspaceBindsExistingSourceWithoutCreatingFiles() {
    val root = Files.createTempDirectory("neuoj-workspace-test")
    try {
      val storage = Workspace(); val p = problem()
      val source = root.resolve("existing.cpp")
      Files.writeString(source, "用户代码")
      assertThrows(IllegalArgumentException::class.java) { storage.importProblem(p, root.resolve("missing.cpp")) }
      storage.importProblem(p, source)
      val edited = storage.load(p.id)!!
      edited.samples.add(Sample("custom-1", "2", "2", true)); storage.save(edited)
      storage.importProblem(p.copy(title = "新题面", samples = mutableListOf(Sample("official-1", "3", "3"))), source)
      assertEquals("用户代码", Files.readString(source))
      assertEquals(source, storage.source(p.id))
      assertEquals("新题面", storage.list().single().title)
      assertEquals(listOf("official-1", "custom-1"), storage.load(p.id)!!.samples.map { it.id })
      assertTrue(Workspace().list().isEmpty())
      assertEquals(listOf(source), Files.list(root).use { it.toList() })
      val other = p.copy(id = "https://oj.neu.edu.cn/problems/84", url = "https://oj.neu.edu.cn/problems/84")
      storage.importProblem(other, source)
      assertNull(storage.load(p.id))
      assertEquals(source, storage.source(other.id))
      storage.delete(other.id); assertTrue(storage.list().isEmpty()); assertTrue(Files.exists(source))
    } finally { root.toFile().deleteRecursively() }
  }
  @Test fun sampleEditsAndRunStatesStayWithTheirIds() {
    val root = Files.createTempDirectory("neuoj-samples-test")
    try {
      val source = root.resolve("existing.cpp")
      Files.writeString(source, "int main(){}")
      val workspace = Workspace()
      val original = problem()
      workspace.importProblem(original, source)
      val imported = workspace.load(original.id)!!
      val first = imported.samples.first()
      assertEquals("1\n", first.originalInput)
      first.input = "changed\n"
      val states = SampleRunState()
      val passed = ProcessResult("1\n", "", 0, 12)
      states.start(listOf(first.id))
      assertEquals(SamplePhase.COMPILING, states.phase(first.id))
      states.running(first.id)
      assertEquals(SamplePhase.RUNNING, states.phase(first.id))
      states.complete(first.id, passed)
      assertEquals(SamplePhase.FINISHED, states.phase(first.id))
      assertTrue(CompareMode.EXACT.matches(passed.stdout, first.output))
      first.output = "edited expected\n"
      workspace.save(imported)
      assertEquals("edited expected\n", workspace.load(original.id)!!.samples.first().output)
      assertFalse(CompareMode.EXACT.matches(passed.stdout, first.output))
      assertSame(passed, states.results[first.id])
      val copy = first.copy(id = "custom-1", custom = true, originalInput = null)
      imported.samples.add(copy)
      imported.samples.add(Sample("custom-2", "", "", true))
      workspace.save(imported)
      assertSame(passed, states.results[first.id])
      imported.samples.remove(copy)
      states.reset(copy.id)
      assertSame(passed, states.results[first.id])
      states.start(listOf("custom-2"))
      assertSame(passed, states.results[first.id])
      states.compileError(listOf("custom-2"), "编译器报错")
      assertEquals(SamplePhase.COMPILE_ERROR, states.phase("custom-2"))
      assertEquals("编译器报错", states.compileDiagnostic)
      states.start(listOf(first.id))
      states.compileError(listOf(first.id), "TC1 编译错误")
      states.start(listOf("custom-2"))
      states.compileDiagnostic = "正在编译…"
      assertEquals("TC1 编译错误", states.diagnostic(first.id))
      states.complete("custom-2", passed)
      states.compileDiagnostic = "退出码：0"
      assertEquals("TC1 编译错误", states.diagnostic(first.id))
      states.reset("custom-2")
      assertNull(states.diagnostic("custom-2"))
      first.restoreInput()
      states.reset(first.id)
      assertEquals("1\n", first.input)
      assertEquals(SamplePhase.IDLE, states.phase(first.id))
      assertNull(states.results[first.id])
      assertNull(states.diagnostic(first.id))
      workspace.importProblem(original.copy(samples = mutableListOf(Sample("official-1", "new\n", "new\n"))), source)
      assertEquals("new\n", workspace.load(original.id)!!.samples.first().originalInput)
    } finally { root.toFile().deleteRecursively() }
  }
  @Test fun compilerDetectionAndArguments() {
    assumeFalse(System.getProperty("os.name").startsWith("Windows"))
    val root = Files.createTempDirectory("neuoj compiler test")
    try {
      assertNull(Compiler.detect(root.toString()))
      val gcc = root.resolve("gcc")
      Files.writeString(gcc, """
        #!/bin/sh
        case "$*" in *-fsyntax-only*) exit 0;; esac
        exit 1
      """.trimIndent())
      gcc.toFile().setExecutable(true)
      assertEquals(0, Processes.execute(listOf(gcc.toString(), "-fsyntax-only"), root, timeoutMs = 1000, cancelled = AtomicBoolean()).exitCode)
      assertNull(Compiler.detect(root.toString()))
      assertThrows(IllegalArgumentException::class.java) { Compiler.validate(gcc.toString()) }
      Files.writeString(gcc, "#!/bin/sh\nexit 0\n")
      assertNull(Compiler.detect(root.toString()))
      val linker = """
        #!/bin/sh
        while [ "$#" -gt 0 ]; do
          if [ "$1" = "-o" ]; then
            shift
            touch "$1"
            chmod +x "$1"
            exit 0
          fi
          shift
        done
        exit 1
      """.trimIndent()
      Files.writeString(gcc, linker)
      assertEquals(gcc.toString(), Compiler.detect(root.toString()))
      val other = Files.createDirectory(root.resolve("other"))
      val gxx = other.resolve("g++")
      Files.writeString(gxx, linker.replace("#!/bin/sh", "#!/bin/sh\nprintf '#define __clang__ 1\\n'"))
      gxx.toFile().setExecutable(true)
      assertEquals(gxx.toString(), Compiler.detect("$root${java.io.File.pathSeparator}$other"))
      Compiler.validate(gxx.toString())
      val settings = HelperSettings()
      settings.loadState(HelperSettings.Values(compiler = root.resolve("missing").toString()))
      assertEquals(gxx.toString(), settings.initializeCompiler("$root${java.io.File.pathSeparator}$other"))
      assertTrue(settings.config.optimize)
      settings.loadState(HelperSettings.Values(compiler = root.resolve("missing").toString()))
      assertEquals("", settings.initializeCompiler(Files.createDirectory(root.resolve("empty")).toString()))
      settings.saveCompiler(gcc.toString(), "C++17", false)
      assertEquals(gcc.toString(), settings.initializeCompiler(other.toString()))
      assertFalse(settings.config.optimize)
      settings.saveCompiler(gcc.toString(), "C++17", false, "-DNAME='hello world' -lm")
      assertEquals("-DNAME='hello world' -lm", settings.config.extraArguments)
      Files.delete(gxx)
      assertThrows(IllegalArgumentException::class.java) { Compiler.validate(gxx.toString()) }
      Compiler.standards.forEach { standard ->
        assertEquals(if (standard.startsWith("C++")) "-std=c++${standard.removePrefix("C++")}" else "-std=c${standard.removePrefix("C")}",
          Compiler.standardFlag(standard))
        assertEquals(if (standard.startsWith("C++")) "C++14" else "C", Compiler.language(standard))
      }
      assertEquals("c", Compiler.command("gcc", "C11", false, root.resolve("a.c"), root.resolve("a"))[3])
      val command = Compiler.command("/path with spaces/g++", "C++17", true, root.resolve("source file.cpp"), root.resolve("output file"))
      assertEquals(8, command.size); assertEquals("-O2", command[2])
      val withoutOptimization = Compiler.command("/path with spaces/g++", "C++17", false, root.resolve("source file.cpp"), root.resolve("output file"))
      assertEquals(7, withoutOptimization.size); assertFalse(withoutOptimization.contains("-O2"))
      assertEquals(listOf("-DNAME=hello world", "-lm"), Compiler.extraArguments("-DNAME='hello world' -lm"))
      assertEquals(listOf("-DNAME=hello world", "-L/path with spaces", ""),
        Compiler.extraArguments("-DNAME=hello\\ world -L\"/path with spaces\" ''"))
      assertEquals(listOf("-DNAME=hello world", "-lm"),
        Compiler.command(gcc.toString(), "C++17", false, source = root.resolve("file.cpp"), binary = root.resolve("file"),
          extra = "-DNAME='hello world' -lm").takeLast(2))
      assertThrows(IllegalArgumentException::class.java) { Compiler.extraArguments("-DNAME='unfinished") }
      assertThrows(IllegalArgumentException::class.java) { Compiler.extraArguments("-DNAME=one\n-lm") }
      assertThrows(IllegalArgumentException::class.java) { Compiler.standardFlag("C++99") }
    } finally { root.toFile().deleteRecursively() }
  }
  @Test fun compilerArgumentsArePortable() {
    val source = Path.of("source file.cpp")
    val binary = Path.of("output file")
    assertEquals(listOf("-DNAME=hello world", "-L/path with spaces", ""),
      Compiler.extraArguments("-DNAME=hello\\ world -L\"/path with spaces\" ''"))
    assertEquals(listOf("-DQUOTE='single'"), Compiler.extraArguments("-DQUOTE=\\'single\\'"))
    assertEquals(listOf("-DNAME=hello world", "-lm"),
      Compiler.command("compiler", "C++17", false, source, binary, "-DNAME='hello world' -lm").takeLast(2))
    assertThrows(IllegalArgumentException::class.java) { Compiler.extraArguments("-DNAME='unfinished") }
    assertThrows(IllegalArgumentException::class.java) { Compiler.extraArguments("-DNAME=one\n-lm") }
  }
  @Test fun processFailuresAndLimits() {
    val root = Files.createTempDirectory("neuoj-process-test")
    try {
      val probe = processProbe(root)
      val normal = Processes.execute(probe + "echo", root, "a\n", 5000, AtomicBoolean())
      assertEquals("a\n", normal.stdout); assertEquals(0, normal.exitCode)
      val bad = Processes.execute(probe + "fail", root, timeoutMs = 5000, cancelled = AtomicBoolean())
      assertEquals(7, bad.exitCode); assertTrue(bad.stderr.contains("diagnostic"))
      val timed = Processes.execute(probe + listOf("sleep", "180"), root, timeoutMs = 5000, cancelled = AtomicBoolean())
      assertNull(timed.failure); assertTrue(timed.elapsedMs >= 150); assertTrue(timed.elapsedMs < 5000)
      assertEquals("超时", Processes.execute(probe + "echo", root, timeoutMs = 0, cancelled = AtomicBoolean()).failure)
      assertEquals("超时", Processes.execute(probe + listOf("sleep", "5000"), root, timeoutMs = 100, cancelled = AtomicBoolean()).failure)
      assertEquals("已取消", Processes.execute(probe + listOf("sleep", "5000"), root, timeoutMs = 1000, cancelled = AtomicBoolean(true)).failure)
      assertEquals("输出超限", Processes.execute(probe + "spam", root, timeoutMs = 5000, cancelled = AtomicBoolean(), maxBytes = 1024).failure)
      val cancel = AtomicBoolean()
      val thread = Thread { Thread.sleep(100); cancel.set(true) }.apply { start() }
      assertEquals("已取消", Processes.execute(probe + listOf("sleep", "5000"), root, timeoutMs = 2000, cancelled = cancel).failure)
      thread.join()
    } finally { root.toFile().deleteRecursively() }
  }
  @Test fun runTimeLabelsUseCpuTime() {
    val result = ProcessResult("", "", 0, 490, cpuTimeMicros = 12_999)
    assertEquals("用时 12 ms", formatRunTime(result))
    assertEquals("用时 <1 ms", formatRunTime(result.copy(cpuTimeMicros = 999)))
    assertEquals("用时不可用", formatRunTime(result.copy(cpuTimeMicros = null)))
  }
  @Test fun nativeTimerSelectsPlatformResource() {
    assertEquals("/native/macos/neuoj-time", NativeCpuTimer.resourcePath("Mac OS X", "aarch64"))
    assertEquals("/native/linux-x64/neuoj-time", NativeCpuTimer.resourcePath("Linux", "amd64"))
    assertEquals("/native/linux-x64/neuoj-time", NativeCpuTimer.resourcePath("Linux", "x86_64"))
    assertEquals("/native/windows-x64/neuoj-time.exe", NativeCpuTimer.resourcePath("Windows 11", "amd64"))
    assertNull(NativeCpuTimer.resourcePath("Windows 11", "aarch64"))
    assertNull(NativeCpuTimer.resourcePath("FreeBSD", "amd64"))
    listOf("/native/macos/neuoj-time", "/native/linux-x64/neuoj-time", "/native/windows-x64/neuoj-time.exe")
      .forEach { assertNotNull(javaClass.getResource(it)) }
    val root = Files.createTempDirectory("neuoj-timer-missing-")
    try { assertNull(NativeCpuTimer.prepare(root, "/native/missing")) }
    finally { root.toFile().deleteRecursively() }
  }
  @Test fun nativeCpuTimerRejectsMissingAndInvalidMetadata() {
    val root = Files.createTempDirectory("neuoj-time-metadata-")
    try {
      val metadata = root.resolve("result")
      assertNull(NativeCpuTimer.read(metadata))
      Files.writeString(metadata, "broken")
      assertNull(NativeCpuTimer.read(metadata))
      Files.writeString(metadata, "neuoj-time-v2\nexit=0\ncpu_us=-1\nwall_us=1\n")
      assertNull(NativeCpuTimer.read(metadata))
      Files.writeString(metadata, "neuoj-time-v2\nexit=4294967296\ncpu_us=1\nwall_us=1\n")
      assertNull(NativeCpuTimer.read(metadata))
      Files.writeString(metadata, "neuoj-time-v2\nexit=0\ncpu_us=1\nwall_us=1\nextra\n")
      assertNull(NativeCpuTimer.read(metadata))
      Files.writeString(metadata, "neuoj-time-v2\nexit=7\ncpu_us=1234\nwall_us=5000\n")
      assertEquals(NativeCpuTimer.Measurement(7, 1234, 5000, null), NativeCpuTimer.read(metadata))
      Files.writeString(metadata, "neuoj-time-v2\nexit=4294967295\ncpu_us=1\nwall_us=1\n")
      assertEquals(-1, NativeCpuTimer.read(metadata)?.exitCode)
      Files.writeString(metadata, "neuoj-time-v2\ntimeout=137\ncpu_us=1234\nwall_us=30000\n")
      assertEquals(NativeCpuTimer.Measurement(137, 1234, 30000, null, timedOut = true), NativeCpuTimer.read(metadata))
    } finally { root.toFile().deleteRecursively() }
  }
  @Test fun nativeCpuTimingCoversAllPlatforms() {
    assumeTrue(NativeCpuTimer.resourcePath() != null)
    val root = Files.createTempDirectory("neuoj native 空格 ")
    try {
      val probe = processProbe(root)
      val hello = Processes.execute(probe + "echo", root, "hello\n", 5000, AtomicBoolean(), measureCpu = true)
      assertNull(hello.failure)
      assertEquals("hello\n", hello.stdout)
      assertNotNull(hello.cpuTimeMicros)
      val sleeping = Processes.execute(probe + listOf("sleep", "300"), root, timeoutMs = 5000,
        cancelled = AtomicBoolean(), measureCpu = true)
      assertNull(sleeping.failure)
      val sleepingCpu = checkNotNull(sleeping.cpuTimeMicros)
      val sleepingWall = checkNotNull(sleeping.sampleWallTimeMicros)
      assertTrue(sleepingWall >= 250_000)
      assertTrue(sleepingCpu + 100_000 < sleepingWall)
      val busy = Processes.execute(probe + "busy", root, timeoutMs = 5000,
        cancelled = AtomicBoolean(), measureCpu = true)
      assertNull(busy.failure)
      assertTrue(checkNotNull(busy.cpuTimeMicros) > sleepingCpu)
      val failed = Processes.execute(probe + "fail", root, timeoutMs = 5000,
        cancelled = AtomicBoolean(), measureCpu = true)
      assertEquals(7, failed.exitCode)
      assertNotNull(failed.cpuTimeMicros)
      assertEquals("超时", Processes.execute(probe + listOf("sleep", "5000"), root,
        timeoutMs = 100, cancelled = AtomicBoolean(), measureCpu = true).failure)
      assertEquals("输出超限", Processes.execute(probe + "spam", root, timeoutMs = 5000,
        cancelled = AtomicBoolean(), maxBytes = 1024, measureCpu = true).failure)
      val cancelled = AtomicBoolean()
      val stopper = Thread { Thread.sleep(100); cancelled.set(true) }.apply { start() }
      assertEquals("已取消", Processes.execute(probe + listOf("sleep", "5000"), root,
        timeoutMs = 5000, cancelled = cancelled, measureCpu = true).failure)
      stopper.join()
      val missing = Processes.execute(listOf(root.resolve("missing executable").toString()), root,
        timeoutMs = 5000, cancelled = AtomicBoolean(), measureCpu = true)
      assertTrue(missing.failure!!.startsWith("无法启动程序"))
      assertNull(missing.cpuTimeMicros)
    } finally { root.toFile().deleteRecursively() }
  }
  @Test fun linuxTimerDoesNotCountDelayedHelperObservationAsTimeout() {
    assumeTrue(System.getProperty("os.name").startsWith("Linux"))
    val root = Files.createTempDirectory("neuoj-linux-time-delay-")
    try {
      val helper = NativeCpuTimer.prepare(root)!!
      val metadata = root.resolve("delayed.result")
      val process = ProcessBuilder(helper.toString(), metadata.toString(), "300", "/bin/sh", "-c",
        "printf r; read line; sleep 0.05").directory(root.toFile()).start()
      try {
        assertEquals('r'.code, process.inputStream.read())
        val stop = ProcessBuilder("/bin/kill", "-STOP", process.pid().toString()).start()
        assertEquals(0, stop.waitFor())
        try {
          process.outputStream.use { it.write("\n".toByteArray()) }
          Thread.sleep(500)
        } finally {
          val resume = ProcessBuilder("/bin/kill", "-CONT", process.pid().toString()).start()
          assertEquals(0, resume.waitFor())
        }
        assertTrue(process.waitFor(2, TimeUnit.SECONDS))
        assertEquals(0, process.exitValue())
        assertFalse(NativeCpuTimer.read(metadata)!!.timedOut)
      } finally {
        runCatching { process.descendants().use { children -> children.forEach { it.destroyForcibly() } } }
        if (process.isAlive) process.destroyForcibly()
        process.waitFor(2, TimeUnit.SECONDS)
      }
    } finally { root.toFile().deleteRecursively() }
  }
  @Test fun linuxTimerStopsChildrenAfterMainProcessExits() {
    assumeTrue(System.getProperty("os.name").startsWith("Linux"))
    val root = Files.createTempDirectory("neuoj-linux-child-cleanup-")
    try {
      val helper = NativeCpuTimer.prepare(root)!!
      val metadata = root.resolve("result")
      val marker = root.resolve("orphan.txt")
      val process = ProcessBuilder(helper.toString(), metadata.toString(), "2000", "/bin/sh", "-c",
        "(sleep 0.6; printf leaked > \"\$1\") &", "sh", marker.toString()).directory(root.toFile()).start()
      assertTrue(process.waitFor(2, TimeUnit.SECONDS))
      assertEquals(0, process.exitValue())
      assertFalse(NativeCpuTimer.read(metadata)!!.timedOut)
      Thread.sleep(800)
      assertFalse(Files.exists(marker))
    } finally { root.toFile().deleteRecursively() }
  }
  @Test fun macCpuTimingCoversExecutionAndFailures() {
    assumeTrue(System.getProperty("os.name").startsWith("Mac"))
    val root = Files.createTempDirectory("neuoj-mac-time-")
    try {
      val source = root.resolve("probe.c")
      val binary = root.resolve("probe")
      Files.writeString(source, """
        #include <stdio.h>
        #include <stdlib.h>
        #include <signal.h>
        #include <unistd.h>
        int main(int argc, char **argv) {
          if (argc > 1 && argv[1][0] == 's') { usleep(180000); return 0; }
          if (argc > 1 && argv[1][0] == 'b') {
            volatile unsigned long value = 0;
            for (unsigned long i = 0; i < 30000000; ++i) value += i;
            return value == 0;
          }
          if (argc > 1 && argv[1][0] == 'e') { fputs("diagnostic", stderr); return 7; }
          if (argc > 1 && argv[1][0] == 't') { raise(SIGTERM); return 0; }
          if (argc > 1 && argv[1][0] == 'o') { for (int i = 0; i < 2000; ++i) puts("overflow"); return 0; }
          char line[128];
          if (fgets(line, sizeof line, stdin)) fputs(line, stdout);
          return 0;
        }
      """.trimIndent())
      val compile = ProcessBuilder("clang", "-O0", source.toString(), "-o", binary.toString()).start()
      assertEquals(String(compile.errorStream.readAllBytes()), 0, compile.waitFor())
      repeat(10) {
        val hello = Processes.execute(listOf(binary.toString()), root, "hello\n", 5000, AtomicBoolean(), measureCpu = true)
        assertNull(hello.failure)
        assertEquals(0, hello.exitCode)
        assertEquals("hello\n", hello.stdout)
        assertNotNull(hello.cpuTimeMicros)
        assertTrue(hello.cpuTimeMicros!! < 100_000)
      }
      val sleeping = Processes.execute(listOf(binary.toString(), "sleep"), root, timeoutMs = 5000,
        cancelled = AtomicBoolean(), measureCpu = true)
      assertNull(sleeping.failure)
      assertTrue(sleeping.elapsedMs >= 150)
      assertTrue(sleeping.sampleWallTimeMicros!! >= 150_000)
      val sleepingCpu = sleeping.cpuTimeMicros!!
      assertTrue(sleepingCpu < 100_000)
      val busy = Processes.execute(listOf(binary.toString(), "busy"), root, timeoutMs = 5000,
        cancelled = AtomicBoolean(), measureCpu = true)
      assertNull(busy.failure)
      assertTrue(busy.cpuTimeMicros!! > sleepingCpu)
      val failed = Processes.execute(listOf(binary.toString(), "error"), root, timeoutMs = 5000,
        cancelled = AtomicBoolean(), measureCpu = true)
      assertEquals(7, failed.exitCode)
      assertEquals("diagnostic", failed.stderr)
      assertNotNull(failed.cpuTimeMicros)
      val signalled = Processes.execute(listOf(binary.toString(), "terminate"), root, timeoutMs = 5000,
        cancelled = AtomicBoolean(), measureCpu = true)
      assertEquals(143, signalled.exitCode)
      assertNotNull(signalled.cpuTimeMicros)
      val missing = Processes.execute(listOf(root.resolve("missing").toString()), root, timeoutMs = 5000,
        cancelled = AtomicBoolean(), measureCpu = true)
      assertTrue(missing.failure!!.startsWith("无法启动程序"))
      assertNull(missing.cpuTimeMicros)
      val timedOut = Processes.execute(listOf(binary.toString(), "sleep"), root, timeoutMs = 30,
        cancelled = AtomicBoolean(), measureCpu = true)
      assertEquals("超时", timedOut.failure)
      assertTrue(timedOut.elapsedMs < 1000)
      assertEquals("输出超限", Processes.execute(listOf(binary.toString(), "overflow"), root, timeoutMs = 5000,
        cancelled = AtomicBoolean(), maxBytes = 1024, measureCpu = true).failure)
      val cancelled = AtomicBoolean()
      val stopper = Thread { Thread.sleep(30); cancelled.set(true) }.apply { start() }
      assertEquals("已取消", Processes.execute(listOf(binary.toString(), "sleep"), root, timeoutMs = 5000,
        cancelled = cancelled, measureCpu = true).failure)
      stopper.join()
    } finally { root.toFile().deleteRecursively() }
  }
  @Test fun macTimerDoesNotCountDelayedHelperObservationAsTimeout() {
    assumeTrue(System.getProperty("os.name").startsWith("Mac"))
    val root = Files.createTempDirectory("neuoj-mac-time-delay-")
    try {
      val helper = NativeCpuTimer.prepare(root)!!
      val metadata = root.resolve("delayed.result")
      val process = ProcessBuilder(helper.toString(), metadata.toString(), "300", "/bin/sh", "-c",
        "printf r; read line; sleep 0.05").directory(root.toFile()).start()
      try {
        assertEquals('r'.code, process.inputStream.read())
        val stop = ProcessBuilder("/bin/kill", "-STOP", process.pid().toString()).start()
        assertEquals(0, stop.waitFor())
        try {
          process.outputStream.use { it.write("\n".toByteArray()) }
          Thread.sleep(500)
        } finally {
          val resume = ProcessBuilder("/bin/kill", "-CONT", process.pid().toString()).start()
          assertEquals(0, resume.waitFor())
        }
        assertTrue(process.waitFor(2, TimeUnit.SECONDS))
        assertEquals(0, process.exitValue())
        val measurement = NativeCpuTimer.read(metadata)!!
        assertFalse(measurement.timedOut)
        assertTrue(measurement.wallTimeMicros!! < 300_000)
      } finally {
        runCatching { process.descendants().use { children -> children.forEach { it.destroyForcibly() } } }
        if (process.isAlive) process.destroyForcibly()
        process.waitFor(2, TimeUnit.SECONDS)
      }
    } finally { root.toFile().deleteRecursively() }
  }
  @Test fun macCancellationStopsTheTimedChild() {
    assumeTrue(System.getProperty("os.name").startsWith("Mac"))
    val root = Files.createTempDirectory("neuoj-mac-cancel-")
    try {
      val cancelled = AtomicBoolean()
      val result = AtomicReference<ProcessResult>()
      val worker = Thread {
        result.set(Processes.execute(listOf("/bin/sh", "-c", "echo $$ > child.pid; sleep 5"), root,
          timeoutMs = 5000, cancelled = cancelled, measureCpu = true))
      }.apply { start() }
      val pidFile = root.resolve("child.pid")
      val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(2)
      while (!Files.exists(pidFile) && System.nanoTime() < deadline) Thread.sleep(10)
      assertTrue(Files.exists(pidFile))
      val childPid = Files.readString(pidFile).trim()
      cancelled.set(true)
      worker.join(2000)
      assertFalse(worker.isAlive)
      assertEquals("已取消", result.get().failure)
      val check = ProcessBuilder("/bin/kill", "-0", childPid).start()
      assertTrue(check.waitFor() != 0)
    } finally { root.toFile().deleteRecursively() }
  }
  @Test fun realGnuCompiler() {
    val compiler = System.getenv("NEUOJ_TEST_GXX") ?: return
    Compiler.validate(compiler)
    val root = Files.createTempDirectory("neuoj real gcc")
    try {
      val p = problem()
      val source = root.resolve("existing.cpp")
      Files.writeString(source, "#include <fstream>\n#include <iostream>\nint main(){std::ofstream(\"runner-created.txt\") << \"temporary\";int x;std::cin>>x;std::cout<<x<<'\\n';}\n")
      val result = Runner().run(p, source, compiler, "C++14", true, AtomicBoolean())
      assertEquals(result.compile.stderr, 0, result.compile.exitCode)
      assertTrue(CompareMode.EXACT.matches(result.tests.single().process.stdout, p.samples.single().output))
      assertFalse(Files.exists(root.resolve("runner-created.txt")))
      Files.writeString(source, "#ifndef NEUOJ_TEST_FLAG\n#error missing custom flag\n#endif\n" + Files.readString(source))
      val withFlag = Runner().run(p, source, compiler, "C++14", true, AtomicBoolean(), extraArguments = "-DNEUOJ_TEST_FLAG=1")
      assertEquals(withFlag.compile.stderr, 0, withFlag.compile.exitCode)
      assertEquals("1\n", withFlag.tests.single().process.stdout)
      val phases = mutableListOf<String>()
      Runner().run(p, source, compiler, "C++14", false, AtomicBoolean(), extraArguments = "-DNEUOJ_TEST_FLAG=1",
        onRunning = { phases.add("运行:$it") }, onCompleted = { phases.add("完成:${it.sampleId}") })
      assertEquals(listOf("运行:official-1", "完成:official-1"), phases)
      Files.writeString(source, "invalid code")
      assertTrue(Runner().run(p, source, compiler, "C++14", false, AtomicBoolean()).tests.isEmpty())
      assertEquals(listOf(source), Files.list(root).use { it.toList() })
    } finally { root.toFile().deleteRecursively() }
  }
  @Test fun realCCompiler() {
    val compiler = System.getenv("NEUOJ_TEST_GCC") ?: return
    Compiler.validate(compiler, "C11")
    val root = Files.createTempDirectory("neuoj-real-c-")
    try {
      val source = root.resolve("answer.c")
      Files.writeString(source, "#include <stdio.h>\nint main(void) { int n; scanf(\"%d\", &n); printf(\"%d\\n\", n); return 0; }\n")
      val result = Runner().run(problem(), source, compiler, "C11", false, AtomicBoolean())
      assertEquals(result.compile.stderr, 0, result.compile.exitCode)
      assertEquals("1\n", result.tests.single().process.stdout)
    } finally { root.toFile().deleteRecursively() }
  }
}
