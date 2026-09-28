package cn.neuoj.helper

import com.intellij.openapi.Disposable
import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.options.ShowSettingsUtil
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.Messages
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.ui.content.ContentFactory
import java.awt.BorderLayout
import java.awt.Dimension
import java.awt.FlowLayout
import java.awt.Font
import java.awt.Graphics
import java.awt.Graphics2D
import java.awt.GridBagConstraints
import java.awt.GridBagLayout
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

private class ExpanderIcon : Icon {
  override fun getIconWidth() = 12
  override fun getIconHeight() = 12
  override fun paintIcon(component: java.awt.Component, graphics: Graphics, x: Int, y: Int) {
    val g = graphics.create() as Graphics2D
    try {
      g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON)
      g.color = component.foreground
      if ((component as? AbstractButton)?.isSelected == true) {
        g.fillPolygon(intArrayOf(x + 2, x + 10, x + 6), intArrayOf(y + 4, y + 4, y + 9), 3)
      } else {
        g.fillPolygon(intArrayOf(x + 4, x + 9, x + 4), intArrayOf(y + 2, y + 6, y + 10), 3)
      }
    } finally { g.dispose() }
  }
}

private class CompareSwitch : JToggleButton() {
  init {
    preferredSize = Dimension(42, 24)
    maximumSize = preferredSize
    isFocusable = false
    isOpaque = false
    isContentAreaFilled = false
    isBorderPainted = false
    toolTipText = "切换输出比较模式"
  }
  override fun paintComponent(graphics: Graphics) {
    val g = graphics.create() as Graphics2D
    try {
      g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON)
      g.color = if (isSelected) UIManager.getColor("Component.focusColor") ?: java.awt.Color(70, 115, 195)
        else UIManager.getColor("Component.borderColor") ?: java.awt.Color.GRAY
      g.fillRoundRect(0, 2, width, height - 4, height - 4, height - 4)
      g.color = UIManager.getColor("Panel.background") ?: java.awt.Color.WHITE
      val diameter = height - 8
      g.fillOval(if (isSelected) width - diameter - 4 else 4, 4, diameter, diameter)
    } finally { g.dispose() }
  }
}

private class CardsPanel : JPanel(), Scrollable {
  init { layout = BoxLayout(this, BoxLayout.Y_AXIS) }
  override fun getPreferredScrollableViewportSize() = preferredSize
  override fun getScrollableUnitIncrement(visibleRect: java.awt.Rectangle, orientation: Int, direction: Int) = 18
  override fun getScrollableBlockIncrement(visibleRect: java.awt.Rectangle, orientation: Int, direction: Int) = visibleRect.height
  override fun getScrollableTracksViewportWidth() = true
  override fun getScrollableTracksViewportHeight() = false
}

class NeuojToolWindowFactory : ToolWindowFactory {
  override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
    val panel = HelperPanel(project)
    val content = ContentFactory.getInstance().createContent(panel, "题目样例", false)
    content.setDisposer(panel)
    toolWindow.contentManager.addContent(content)
  }
}

class HelperPanel(private val project: Project) : JPanel(BorderLayout(0, 6)), Disposable {
  private val service = project.getService(ProjectWorkspace::class.java)
  private val problemTitle = JLabel("无题目")
  private val cardsPanel = CardsPanel()
  private val cards = mutableListOf<SampleCard>()
  private val results = mutableMapOf<String, ProcessResult>()
  private var mode = runCatching { CompareMode.valueOf(HelperSettings.instance().config.mode) }.getOrDefault(CompareMode.TOKENS)
  private var problem: Problem? = null
  private var compileDiagnostic = "尚未编译"
  private var cancellation = AtomicBoolean()
  private var running = false
  private var disposed = false
  private var generation = 0
  private val changed: () -> Unit = { reload(service.lastImportedId ?: problem?.id) }
  private val runAll = icon("▶", "运行全部样例") { run(null) }
  private val stop = icon("■", "取消运行") { cancellation.set(true); updateStatus("正在取消…") }

  init {
    border = BorderFactory.createEmptyBorder(6, 6, 6, 6)
    problemTitle.border = BorderFactory.createEmptyBorder(4, 8, 4, 8)

    val actions = JPanel().apply { layout = BoxLayout(this, BoxLayout.X_AXIS) }
    stop.isEnabled = false
    actions.add(Box.createHorizontalGlue())
    actions.add(runAll); actions.add(Box.createHorizontalStrut(2)); actions.add(stop)
    val modeLabel = JLabel().apply { preferredSize = Dimension(64, 28); maximumSize = preferredSize }
    val modeSwitch = CompareSwitch().apply {
      isSelected = mode == CompareMode.EXACT
      fun syncLabel() {
        modeLabel.text = if (isSelected) "逐字符" else "忽略空白"
        val name = if (isSelected) "逐字符比较" else "忽略空白字符比较"
        accessibleContext.accessibleName = name
        toolTipText = "$name：${if (isSelected) "只统一 CRLF 换行" else "按非空白词逐个比较"}"
      }
      syncLabel()
      addActionListener {
        mode = if (isSelected) CompareMode.EXACT else CompareMode.TOKENS
        HelperSettings.instance().config.mode = mode.name
        syncLabel(); refreshResults()
      }
    }
    actions.add(Box.createHorizontalStrut(2)); actions.add(modeSwitch)
    actions.add(Box.createHorizontalStrut(2)); actions.add(modeLabel)
    actions.add(Box.createHorizontalStrut(2))
    actions.add(icon("⚙", "编译器设置") { ShowSettingsUtil.getInstance().showSettingsDialog(project, HelperConfigurable::class.java) })
    val more = icon("⋯", "更多题目操作") {}
    more.addActionListener { showMenu(more) }
    actions.add(Box.createHorizontalStrut(2)); actions.add(more)
    add(JPanel(BorderLayout(0, 4)).apply {
      add(problemTitle, BorderLayout.NORTH); add(actions, BorderLayout.SOUTH)
    }, BorderLayout.NORTH)

    add(JScrollPane(cardsPanel).apply {
      border = BorderFactory.createEmptyBorder()
      horizontalScrollBarPolicy = ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER
      verticalScrollBarPolicy = ScrollPaneConstants.VERTICAL_SCROLLBAR_ALWAYS
      verticalScrollBar.unitIncrement = 18
    }, BorderLayout.CENTER)
    add(JPanel(BorderLayout()).apply {
      add(icon("＋", "新增自定义样例") { addSample() }, BorderLayout.WEST)
    }, BorderLayout.SOUTH)

    service.listeners.add(changed)
    reload(null)
    ApplicationManager.getApplication().executeOnPooledThread {
      HelperSettings.instance().initializeCompiler()
      IdeBridge.instance().start()
      later {
        if (HelperSettings.instance().config.compiler.isBlank()) updateStatus("请选择 GNU g++（⚙）")
      }
    }
  }

  private fun icon(symbol: String, name: String, action: () -> Unit) = JButton(GlyphIcon(symbol)).apply {
    margin = java.awt.Insets(3, 7, 3, 7); isFocusable = false
    preferredSize = Dimension(30, 28)
    maximumSize = preferredSize
    toolTipText = name; accessibleContext.accessibleName = name
    addActionListener { action() }
  }
  private fun later(action: () -> Unit) = ApplicationManager.getApplication().invokeLater {
    if (!disposed && !project.isDisposed) action()
  }
  private fun updateStatus(message: String, failure: Boolean = false) {
    runAll.toolTipText = "运行全部样例 · $message"
    stop.toolTipText = "取消运行 · $message"
    if (failure) NotificationGroupManager.getInstance().getNotificationGroup("NEUOJ Helper")
      .createNotification(message, NotificationType.ERROR).notify(project)
  }
  private fun reload(id: String?) {
    generation++; cancellation.set(true); results.clear()
    selectProblem(id?.let { service.workspace.load(it) } ?: service.workspace.list().firstOrNull())
  }
  private fun selectProblem(value: Problem?) {
    if (value?.id != problem?.id) { generation++; cancellation.set(true); results.clear() }
    problem = value
    problemTitle.text = value?.title ?: "无题目"
    updateStatus(if (value == null) "在浏览器题目页点击“导入题目”" else "已载入 ${value.samples.size} 组样例")
    cards.clear(); cardsPanel.removeAll()
    if (value == null) cardsPanel.add(JLabel("在浏览器题目页点击“导入题目”"))
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
    private val resultPanel = JPanel(BorderLayout(0, 3)).apply { alignmentX = LEFT_ALIGNMENT }
    private val fields = JPanel().apply { layout = BoxLayout(this, BoxLayout.Y_AXIS) }
    private val expander = JToggleButton(ExpanderIcon())
    init {
      alignmentX = LEFT_ALIGNMENT
      maximumSize = Dimension(Int.MAX_VALUE, Int.MAX_VALUE)
      border = BorderFactory.createCompoundBorder(
        BorderFactory.createLineBorder(UIManager.getColor("Component.borderColor") ?: java.awt.Color.GRAY),
        BorderFactory.createEmptyBorder(8, 8, 8, 8)
      )
      val title = JPanel(BorderLayout(8, 0)).apply { preferredSize = Dimension(0, 30) }
      title.add(JPanel(GridBagLayout()).apply {
        val position = GridBagConstraints().apply { gridy = 0; anchor = GridBagConstraints.CENTER }
        add(expander.apply {
          margin = java.awt.Insets(2, 5, 2, 5)
          preferredSize = Dimension(28, 28)
          isSelected = number == 1
          toolTipText = "展开或折叠样例"
          accessibleContext.accessibleName = "展开或折叠 TC $number"
          addActionListener {
            fields.isVisible = isSelected
            fitHeight()
          }
        }, position.apply { gridx = 0; insets = java.awt.Insets(0, 0, 0, 8) })
        add(JLabel("TC $number${if (sample.custom) " · 自定义" else ""}"), position.apply { gridx = 1; insets = java.awt.Insets(0, 0, 0, 4) })
        add(resultLabel, position.apply { gridx = 2; insets = java.awt.Insets(0, 0, 0, 0) })
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
        maximumSize = Dimension(Int.MAX_VALUE, Int.MAX_VALUE)
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
    item("打开关联文件") { later { openSource() } }
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
    val path = service.workspace.source(p.id) ?: return
    com.intellij.openapi.vfs.LocalFileSystem.getInstance().refreshAndFindFileByNioFile(path)?.let {
      FileEditorManager.getInstance(project).openFile(it, true)
    }
  }
  private fun deleteProblem() {
    if (running) return
    val p = problem ?: return
    if (Messages.showYesNoDialog(project, "解除此题与代码文件的关联并清除本次会话的样例？代码文件不会删除。", "清理题目", Messages.getQuestionIcon()) != Messages.YES) return
    service.workspace.delete(p.id); results.clear(); reload(null)
  }
  private fun run(sampleId: String?) {
    later { runInWriteIntent(sampleId) }
  }
  private fun runInWriteIntent(sampleId: String?) {
    if (running) return
    val p = problem ?: return
    val source = service.workspace.source(p.id)
    if (source == null || !Files.isRegularFile(source)) { updateStatus("关联的代码文件不存在，请重新导入题目", true); return }
    val file = com.intellij.openapi.vfs.LocalFileSystem.getInstance().refreshAndFindFileByNioFile(source)
    if (file == null) { updateStatus("关联的代码文件不可用，请重新导入题目", true); return }
    try {
      FileDocumentManager.getInstance().getDocument(file)?.let { FileDocumentManager.getInstance().saveDocument(it) }
    } catch (error: Exception) { updateStatus("保存代码文件失败：${error.message}", true); return }
    val settings = HelperSettings.instance().config.copy()
    if (settings.compiler.isBlank()) { updateStatus("请选择 GNU g++（⚙）", true); return }
    val selected = p.samples.filter { sampleId == null || it.id == sampleId }
    if (selected.isEmpty()) return
    val snapshot = p.copy(samples = selected.map { it.copy() }.toMutableList())
    val current = ++generation
    cancellation = AtomicBoolean(); val taskCancel = cancellation
    running = true; results.clear(); refreshResults()
    compileDiagnostic = "正在编译…"
    cards.forEach { it.setRunning(true) }
    runAll.isEnabled = false; stop.isEnabled = true
    updateStatus("正在编译并运行…")
    ApplicationManager.getApplication().executeOnPooledThread {
      val outcome = runCatching { Runner().run(snapshot, source, settings.compiler, settings.standard, taskCancel) }
      later {
        running = false; runAll.isEnabled = true; stop.isEnabled = false; cards.forEach { it.setRunning(false) }
        if (current != generation) { updateStatus("题目已变化，旧运行已取消"); return@later }
        outcome.onSuccess { result ->
          compileDiagnostic = "退出码：${result.compile.exitCode}\n${result.compile.failure ?: ""}\n${result.compile.stdout}\n${result.compile.stderr}"
          if (result.compile.failure != null || result.compile.exitCode != 0) {
            updateStatus("编译失败（查看 ⋯ 中的诊断）", true)
          } else {
            result.tests.forEach { results[it.sampleId] = it.process }
            if (sampleId != null) cards.find { it.sample.id == sampleId }?.expand()
            val executionFailed = !taskCancel.get() && result.tests.any {
              it.process.failure != null || it.process.exitCode != 0
            }
            updateStatus(when {
              taskCancel.get() -> "已取消"
              executionFailed -> "样例运行失败（查看 TC 结果）"
              else -> "运行完成 · 本地结果仅供参考"
            }, executionFailed)
          }
          refreshResults()
        }.onFailure {
          compileDiagnostic = it.message ?: "运行失败"
          updateStatus("运行失败（查看 ⋯ 中的诊断）", true)
        }
      }
    }
  }
  override fun dispose() { disposed = true; cancellation.set(true); service.listeners.remove(changed) }
}
