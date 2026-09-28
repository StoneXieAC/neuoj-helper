package cn.neuoj.helper

import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.fileChooser.FileChooser
import com.intellij.openapi.fileChooser.FileChooserDescriptorFactory
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.options.ShowSettingsUtil
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.Messages
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.ui.content.ContentFactory
import java.awt.BorderLayout
import java.awt.Dimension
import java.awt.FlowLayout
import java.awt.Font
import java.awt.Graphics
import java.awt.Graphics2D
import java.awt.RenderingHints
import java.nio.file.Files
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import javax.swing.*
import javax.swing.event.DocumentEvent
import javax.swing.event.DocumentListener

private class GlyphIcon(private val symbol: String) : Icon {
  override fun getIconWidth() = 16
  override fun getIconHeight() = 16
  override fun paintIcon(component: java.awt.Component, graphics: Graphics, x: Int, y: Int) {
    val g = graphics.create() as Graphics2D
    try {
      g.setRenderingHint(RenderingHints.KEY_TEXT_ANTIALIASING, RenderingHints.VALUE_TEXT_ANTIALIAS_ON)
      g.color = component.foreground
      g.font = (UIManager.getFont("Button.font") ?: Font(Font.DIALOG, Font.PLAIN, 12)).deriveFont(15f)
      val metrics = g.fontMetrics
      g.drawString(symbol, x + (16 - metrics.stringWidth(symbol)) / 2, y + (16 - metrics.height) / 2 + metrics.ascent)
    } finally { g.dispose() }
  }
}

class NeuojToolWindowFactory : ToolWindowFactory {
  override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
    val panel = HelperPanel(project)
    val content = ContentFactory.getInstance().createContent(panel, "题目与样例", false)
    content.setDisposer(panel)
    toolWindow.contentManager.addContent(content)
  }
}

class HelperPanel(private val project: Project) : JPanel(BorderLayout(0, 6)), Disposable {
  private val service = project.getService(ProjectWorkspace::class.java)
  private val problemBox = JComboBox<Problem>()
  private val cardsPanel = JPanel()
  private val status = JLabel("在浏览器题目页点击“导入到 IDE”")
  private val cards = mutableListOf<SampleCard>()
  private val results = mutableMapOf<String, ProcessResult>()
  private var mode = runCatching { CompareMode.valueOf(HelperSettings.instance().config.mode) }.getOrDefault(CompareMode.TOKENS)
  private var problem: Problem? = null
  private var compileDiagnostic = "尚未编译"
  private var cancellation = AtomicBoolean()
  private var running = false
  private var reloading = false
  private var disposed = false
  private var generation = 0
  private val changed: () -> Unit = { reload(service.lastImportedId ?: problem?.id) }
  private val runAll = icon("▶", "运行全部样例") { run(null) }
  private val stop = icon("■", "取消运行") { cancellation.set(true); status.text = "正在取消…" }
  private val receiver = icon("◎", "接收到此项目") { selectReceiver() }

  init {
    border = BorderFactory.createEmptyBorder(6, 6, 6, 6)
    problemBox.renderer = DefaultListCellRenderer().let { renderer -> ListCellRenderer { list, value, index, selected, focus ->
      renderer.getListCellRendererComponent(list, value?.title ?: "尚未导入题目", index, selected, focus)
    } }
    problemBox.toolTipText = "选择题目"
    problemBox.addActionListener { if (!reloading) selectProblem(problemBox.selectedItem as? Problem) }

    val actions = JPanel(FlowLayout(FlowLayout.RIGHT, 2, 0))
    stop.isEnabled = false
    actions.add(receiver); actions.add(runAll); actions.add(stop)
    val modes = ButtonGroup()
    fun modeButton(symbol: String, label: String, help: String, value: CompareMode) = JToggleButton(GlyphIcon(symbol)).apply {
      margin = java.awt.Insets(3, 7, 3, 7); isFocusable = false
      preferredSize = Dimension(30, 28)
      toolTipText = help; accessibleContext.accessibleName = label
      isSelected = mode == value
      addActionListener { mode = value; HelperSettings.instance().config.mode = value.name; refreshResults() }
      modes.add(this); actions.add(this)
    }
    modeButton("≋", "忽略空白比较", "按非空白词逐个比较", CompareMode.TOKENS)
    modeButton("¶", "逐字比较", "只统一 CRLF 换行", CompareMode.EXACT)
    actions.add(icon("⚙", "编译器与连接设置") { ShowSettingsUtil.getInstance().showSettingsDialog(project, HelperConfigurable::class.java) })
    val more = icon("⋯", "更多题目操作") {}
    more.addActionListener { showMenu(more) }
    actions.add(more)
    add(JPanel(BorderLayout(0, 4)).apply {
      add(problemBox, BorderLayout.NORTH); add(actions, BorderLayout.SOUTH)
    }, BorderLayout.NORTH)

    cardsPanel.layout = BoxLayout(cardsPanel, BoxLayout.Y_AXIS)
    add(JScrollPane(cardsPanel).apply {
      border = BorderFactory.createEmptyBorder()
      horizontalScrollBarPolicy = ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER
      verticalScrollBar.unitIncrement = 18
    }, BorderLayout.CENTER)
    add(JPanel(BorderLayout(4, 0)).apply {
      add(icon("＋", "新增自定义样例") { addSample() }, BorderLayout.WEST)
      add(status, BorderLayout.CENTER)
    }, BorderLayout.SOUTH)

    service.listeners.add(changed)
    reload(null)
    ApplicationManager.getApplication().executeOnPooledThread {
      HelperSettings.instance().initializeCompiler()
      IdeBridge.instance().select(project)
      later {
        receiver.toolTipText = "接收项目：${project.name}"
        if (HelperSettings.instance().config.compiler.isBlank()) status.text = "请选择 GNU g++（⚙）"
      }
    }
  }

  private fun icon(symbol: String, name: String, action: () -> Unit) = JButton(GlyphIcon(symbol)).apply {
    margin = java.awt.Insets(3, 7, 3, 7); isFocusable = false
    preferredSize = Dimension(30, 28)
    toolTipText = name; accessibleContext.accessibleName = name
    addActionListener { action() }
  }
  private fun later(action: () -> Unit) = ApplicationManager.getApplication().invokeLater {
    if (!disposed && !project.isDisposed) action()
  }
  private fun selectReceiver() {
    ApplicationManager.getApplication().executeOnPooledThread {
      IdeBridge.instance().select(project)
      later { receiver.toolTipText = "接收项目：${project.name}"; status.text = IdeBridge.instance().status }
    }
  }

  private fun reload(id: String?) {
    generation++; cancellation.set(true); results.clear()
    reloading = true
    problemBox.removeAllItems()
    service.workspace.list().forEach { problemBox.addItem(it) }
    val index = (0 until problemBox.itemCount).indexOfFirst { problemBox.getItemAt(it).id == id }
    if (index >= 0) problemBox.selectedIndex = index
    reloading = false
    selectProblem(problemBox.selectedItem as? Problem)
  }
  private fun selectProblem(value: Problem?) {
    if (value?.id != problem?.id) { generation++; cancellation.set(true); results.clear() }
    problem = value
    status.text = if (value == null) "在浏览器题目页点击“导入到 IDE”" else "已载入 ${value.samples.size} 组样例"
    cards.clear(); cardsPanel.removeAll()
    if (value == null) cardsPanel.add(JLabel("在浏览器题目页点击“导入到 IDE”"))
    else value.samples.forEachIndexed { index, sample ->
      val card = SampleCard(value, sample, index + 1)
      cards.add(card); cardsPanel.add(card); cardsPanel.add(Box.createVerticalStrut(8))
    }
    cardsPanel.revalidate(); cardsPanel.repaint()
  }
  private fun addSample() {
    if (running) return
    val p = problem ?: return
    val sample = Sample("custom-${UUID.randomUUID()}", "", "", true)
    p.samples.add(sample); service.workspace.save(p); selectProblem(p)
    cards.lastOrNull()?.input?.requestFocusInWindow()
  }

  private inner class SampleCard(private val owner: Problem, val sample: Sample, private val number: Int) : JPanel(BorderLayout(0, 5)) {
    val input = JTextArea(sample.input, 5, 20)
    private val expected = JTextArea(sample.output, 5, 20)
    private val actual = JTextArea(4, 20)
    private val resultLabel = JLabel("未运行")
    private val resultPanel = JPanel(BorderLayout(0, 3))
    private val fields = JPanel().apply { layout = BoxLayout(this, BoxLayout.Y_AXIS) }
    private val expander = JToggleButton(GlyphIcon("⌄"))
    init {
      alignmentX = LEFT_ALIGNMENT
      maximumSize = Dimension(Int.MAX_VALUE, Int.MAX_VALUE)
      border = BorderFactory.createCompoundBorder(
        BorderFactory.createLineBorder(UIManager.getColor("Component.borderColor") ?: java.awt.Color.GRAY),
        BorderFactory.createEmptyBorder(8, 8, 8, 8)
      )
      val title = JPanel(BorderLayout())
      title.add(JPanel(FlowLayout(FlowLayout.LEFT, 4, 0)).apply {
        add(expander.apply {
          margin = java.awt.Insets(2, 5, 2, 5)
          preferredSize = Dimension(28, 26)
          isSelected = number == 1
          toolTipText = "展开或折叠样例"
          accessibleContext.accessibleName = "展开或折叠 TC $number"
          addActionListener {
            fields.isVisible = isSelected
            fitHeight()
          }
        })
        add(JLabel("TC $number${if (sample.custom) " · 自定义" else ""}")); add(resultLabel)
      }, BorderLayout.WEST)
      title.add(JPanel(FlowLayout(FlowLayout.RIGHT, 2, 0)).apply {
        add(icon("▶", "运行此样例") { run(sample.id) })
        add(icon("⧉", "复制为自定义样例") { duplicate(sample) })
        if (sample.custom) add(icon("✕", "删除此自定义样例") { deleteSample(sample) })
      }, BorderLayout.EAST)
      add(title, BorderLayout.NORTH)
      fields.add(field("输入", input)); fields.add(Box.createVerticalStrut(6))
      fields.add(field("预期输出", expected)); fields.add(Box.createVerticalStrut(6))
      actual.isEditable = false
      resultPanel.add(field("实际输出", actual), BorderLayout.CENTER)
      resultPanel.isVisible = false
      fields.add(resultPanel)
      fields.isVisible = number == 1
      add(fields, BorderLayout.CENTER)
      if (sample.custom) {
        observe(input) { sample.input = input.text; results.remove(sample.id) }
        observe(expected) { sample.output = expected.text }
      }
      fitHeight()
    }
    private fun field(label: String, area: JTextArea): JComponent {
      area.isEditable = sample.custom && area !== actual
      area.font = Font(Font.MONOSPACED, Font.PLAIN, 12)
      area.accessibleContext.accessibleName = "TC $number $label"
      return JPanel(BorderLayout(0, 2)).apply {
        alignmentX = LEFT_ALIGNMENT
        add(JLabel(label), BorderLayout.NORTH)
        add(JScrollPane(area).apply { preferredSize = Dimension(160, if (area === actual) 80 else 96) }, BorderLayout.CENTER)
      }
    }
    private fun observe(area: JTextArea, change: () -> Unit) {
      area.document.addDocumentListener(object : DocumentListener {
        override fun insertUpdate(e: DocumentEvent) = persist()
        override fun removeUpdate(e: DocumentEvent) = persist()
        override fun changedUpdate(e: DocumentEvent) = persist()
        private fun persist() {
          if (running || problem !== owner) return
          change(); service.workspace.save(owner); refreshResults()
        }
      })
    }
    fun showResult() {
      val result = results[sample.id]
      val outcome = result?.let { verdict(it, sample.output) } ?: "未运行"
      resultLabel.text = outcome
      resultLabel.foreground = when (outcome) {
        "通过" -> java.awt.Color(74, 150, 78)
        "未运行" -> UIManager.getColor("Label.foreground")
        else -> java.awt.Color(205, 83, 75)
      }
      if (result == null) {
        resultPanel.isVisible = false
        fitHeight()
        return
      }
      actual.text = buildString {
        append(result.stdout)
        if (result.stderr.isNotBlank()) append("\n标准错误：\n").append(result.stderr)
        append("\n\n").append(result.elapsedMs).append(" ms · 退出码 ").append(result.exitCode)
      }
      resultPanel.isVisible = true
      fitHeight()
    }
    fun setRunning(value: Boolean) {
      input.isEditable = sample.custom && !value
      expected.isEditable = sample.custom && !value
    }
    fun expand() {
      expander.isSelected = true
      fields.isVisible = true
      fitHeight()
    }
    private fun fitHeight() {
      invalidate()
      maximumSize = Dimension(Int.MAX_VALUE, super.getPreferredSize().height)
      revalidate()
      cardsPanel.revalidate()
      cardsPanel.repaint()
    }
  }
  private fun verdict(result: ProcessResult, expected: String) = result.failure ?: when {
    result.exitCode != 0 -> "运行异常"
    mode.matches(result.stdout, expected) -> "通过"
    else -> "输出不符"
  }
  private fun refreshResults() {
    cards.forEach { it.showResult() }
    cardsPanel.revalidate(); cardsPanel.repaint()
  }
  private fun duplicate(sample: Sample) {
    if (running) return
    val p = problem ?: return
    p.samples.add(sample.copy(id = "custom-${UUID.randomUUID()}", custom = true))
    service.workspace.save(p); selectProblem(p)
  }
  private fun deleteSample(sample: Sample) {
    if (running || !sample.custom) return
    val p = problem ?: return
    if (Messages.showYesNoDialog(project, "删除这条自定义样例？", "删除样例", Messages.getQuestionIcon()) != Messages.YES) return
    p.samples.remove(sample); service.workspace.save(p); results.remove(sample.id); selectProblem(p)
  }
  private fun showMenu(anchor: JButton) {
    val menu = JPopupMenu()
    fun item(label: String, action: () -> Unit) { menu.add(JMenuItem(label).apply { addActionListener { action() } }) }
    item("查看题面") { showStatement() }
    item("编译诊断") { showText("编译诊断", compileDiagnostic) }
    item("打开源码") { openSource() }
    item("另存题目") { exportProblem() }
    menu.addSeparator()
    item("清理此题") { deleteProblem() }
    menu.show(anchor, 0, anchor.height)
  }
  private fun showStatement() {
    val p = problem ?: return
    showText("题面", "${p.title}\n${p.url}\n\n${p.statement}\n\n${p.images.joinToString("\n")}")
  }
  private fun showText(title: String, content: String) {
    val text = JTextArea(content)
    text.isEditable = false; text.lineWrap = true; text.wrapStyleWord = true
    JDialog(SwingUtilities.getWindowAncestor(this), title).apply {
      contentPane.add(JScrollPane(text)); setSize(650, 650)
      setLocationRelativeTo(this@HelperPanel); isVisible = true
    }
  }
  private fun openSource() {
    val p = problem ?: return
    LocalFileSystem.getInstance().refreshAndFindFileByNioFile(service.workspace.directory(p.id).resolve("main.cpp"))?.let {
      FileEditorManager.getInstance(project).openFile(it, true)
    }
  }
  private fun exportProblem() {
    if (running) return
    val p = problem ?: return
    FileDocumentManager.getInstance().saveAllDocuments()
    val selected = FileChooser.chooseFile(FileChooserDescriptorFactory.createSingleFolderDescriptor().withTitle("选择另存目录"), project, null) ?: return
    val destination = selected.toNioPath().resolve("neuoj-${digest(p.id).take(12)}")
    if (Files.exists(destination)) { status.text = "目标题目目录已存在"; return }
    try {
      Files.createDirectories(destination)
      val source = service.workspace.directory(p.id)
      for (file in listOf("main.cpp", "problem.json")) Files.copy(source.resolve(file), destination.resolve(file))
      status.text = "题目已另存"
      status.toolTipText = destination.toString()
    } catch (e: Exception) { status.text = "另存失败：${e.message}" }
  }
  private fun deleteProblem() {
    if (running) return
    val p = problem ?: return
    if (Messages.showYesNoDialog(project, "将删除此题源码、样例和本地结果。请先另存需要保留的代码。", "清理题目", Messages.getWarningIcon()) != Messages.YES) return
    val dir = service.workspace.directory(p.id)
    LocalFileSystem.getInstance().refreshAndFindFileByNioFile(dir.resolve("main.cpp"))?.let { FileEditorManager.getInstance(project).closeFile(it) }
    service.workspace.delete(p.id); results.clear(); reload(null)
  }
  private fun run(sampleId: String?) {
    if (running) return
    val p = problem ?: return
    FileDocumentManager.getInstance().saveAllDocuments()
    val settings = HelperSettings.instance().config.copy()
    if (settings.compiler.isBlank()) { status.text = "请选择 GNU g++（⚙）"; return }
    val selected = p.samples.filter { sampleId == null || it.id == sampleId }
    if (selected.isEmpty()) return
    val snapshot = p.copy(samples = selected.map { it.copy() }.toMutableList())
    val current = ++generation
    cancellation = AtomicBoolean(); val taskCancel = cancellation
    running = true; results.clear(); refreshResults()
    compileDiagnostic = "正在编译…"
    cards.forEach { it.setRunning(true) }
    runAll.isEnabled = false; stop.isEnabled = true
    status.text = "正在编译并运行…"
    ApplicationManager.getApplication().executeOnPooledThread {
      val outcome = runCatching { Runner().run(snapshot, service.workspace.directory(p.id), settings.compiler, settings.standard, taskCancel) }
      later {
        running = false; runAll.isEnabled = true; stop.isEnabled = false; cards.forEach { it.setRunning(false) }
        if (current != generation) { status.text = "题目已变化，旧运行已取消"; return@later }
        outcome.onSuccess { result ->
          compileDiagnostic = "退出码：${result.compile.exitCode}\n${result.compile.failure ?: ""}\n${result.compile.stdout}\n${result.compile.stderr}"
          if (result.compile.failure != null || result.compile.exitCode != 0) {
            status.text = "编译失败（查看 ⋯ 中的诊断）"
            status.toolTipText = result.compile.failure ?: result.compile.stderr.take(300)
          } else {
            result.tests.forEach { results[it.sampleId] = it.process }
            if (sampleId != null) cards.find { it.sample.id == sampleId }?.expand()
            status.text = if (taskCancel.get()) "已取消" else "运行完成 · 本地结果仅供参考"
          }
          refreshResults()
        }.onFailure {
          compileDiagnostic = it.message ?: "运行失败"
          status.text = "运行失败（查看 ⋯ 中的诊断）"
          status.toolTipText = compileDiagnostic
        }
      }
    }
  }
  override fun dispose() { disposed = true; cancellation.set(true); service.listeners.remove(changed) }
}
