package cn.neuoj.helper

import org.junit.Assert.*
import org.junit.Test
import java.nio.file.Files
import java.nio.file.Path
import java.util.concurrent.atomic.AtomicBoolean

class CoreTest {
  private fun problem() = Problem(id = "https://oj.neu.edu.cn/problems/83", url = "https://oj.neu.edu.cn/problems/83", title = "测试题目", statement = "题面", samples = mutableListOf(Sample("official-1", "1\n", "1\n")))
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
    val root = Files.createTempDirectory("neuoj compiler test")
    try {
      assertNull(Compiler.detect(root.toString()))
      val fake = root.resolve("g++")
      Files.writeString(fake, "#!/bin/sh\nprintf '#define __GNUC__ 4\\n#define __clang__ 1\\n'\n")
      fake.toFile().setExecutable(true)
      assertNull(Compiler.detect(root.toString()))
      assertThrows(IllegalArgumentException::class.java) { Compiler.validate(fake.toString()) }
      Files.writeString(fake, "#!/bin/sh\nprintf '#define __GNUC__ 16\\n'\n")
      assertEquals(fake.toString(), Compiler.detect(root.toString()))
      val versioned = root.resolve("g++-16"); Files.move(fake, versioned)
      Compiler.validate(versioned.toString())
      assertNull(Compiler.detect(root.toString()))
      Files.delete(versioned)
      assertThrows(IllegalArgumentException::class.java) { Compiler.validate(versioned.toString()) }
      Compiler.standards.forEach { assertEquals("-std=c++${it.removePrefix("C++")}", Compiler.standardFlag(it)) }
      val command = Compiler.command("/path with spaces/g++-16", "C++17", root.resolve("source file.cpp"), root.resolve("output file"))
      assertEquals(8, command.size); assertEquals("-O2", command[2])
      assertThrows(IllegalArgumentException::class.java) { Compiler.standardFlag("C++99") }
    } finally { root.toFile().deleteRecursively() }
  }
  @Test fun processFailuresAndLimits() {
    val root = Files.createTempDirectory("neuoj-process-test")
    try {
      val normal = Processes.execute(listOf("/bin/cat"), root, "a\n", 1000, AtomicBoolean())
      assertEquals("a\n", normal.stdout); assertEquals(0, normal.exitCode)
      val bad = Processes.execute(listOf("/bin/sh", "-c", "echo diagnostic >&2; exit 7"), root, timeoutMs = 1000, cancelled = AtomicBoolean())
      assertEquals(7, bad.exitCode); assertTrue(bad.stderr.contains("diagnostic"))
      assertEquals("超时", Processes.execute(listOf("/bin/sleep", "10"), root, timeoutMs = 100, cancelled = AtomicBoolean()).failure)
      assertEquals("已取消", Processes.execute(listOf("/bin/sleep", "10"), root, timeoutMs = 1000, cancelled = AtomicBoolean(true)).failure)
      assertEquals("输出超限", Processes.execute(listOf("/usr/bin/yes"), root, timeoutMs = 1000, cancelled = AtomicBoolean(), maxBytes = 1024).failure)
      val cancel = AtomicBoolean()
      val thread = Thread { Thread.sleep(100); cancel.set(true) }.apply { start() }
      assertEquals("已取消", Processes.execute(listOf("/bin/sleep", "10"), root, timeoutMs = 2000, cancelled = cancel).failure)
      thread.join()
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
      val result = Runner().run(p, source, compiler, "C++14", AtomicBoolean())
      assertEquals(result.compile.stderr, 0, result.compile.exitCode)
      assertTrue(CompareMode.EXACT.matches(result.tests.single().process.stdout, p.samples.single().output))
      assertFalse(Files.exists(root.resolve("runner-created.txt")))
      val phases = mutableListOf<String>()
      Runner().run(p, source, compiler, "C++14", AtomicBoolean(),
        onRunning = { phases.add("运行:$it") }, onCompleted = { phases.add("完成:${it.sampleId}") })
      assertEquals(listOf("运行:official-1", "完成:official-1"), phases)
      Files.writeString(source, "invalid code")
      assertTrue(Runner().run(p, source, compiler, "C++14", AtomicBoolean()).tests.isEmpty())
      assertEquals(listOf(source), Files.list(root).use { it.toList() })
    } finally { root.toFile().deleteRecursively() }
  }
}
