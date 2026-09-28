package cn.neuoj.helper

import com.intellij.openapi.Disposable
import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.fileEditor.FileDocumentManager
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
import java.awt.BasicStroke
import java.awt.Color
import java.awt.Shape
import java.awt.event.MouseWheelEvent
import java.nio.file.Files
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import javax.swing.*
import javax.swing.text.Highlighter
import javax.swing.text.JTextComponent
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

private fun paintPressFeedback(graphics: Graphics, button: AbstractButton) {
  if (!button.model.isArmed || !button.model.isPressed) return
  val g = graphics.create() as Graphics2D
  try {
    g.color = Color(110, 145, 210, 65)
    g.fillRoundRect(1, 1, button.width - 2, button.height - 2, 6, 6)
  } finally { g.dispose() }
}

private class FeedbackButton(icon: Icon) : JButton(icon) {
  override fun paintComponent(graphics: Graphics) { super.paintComponent(graphics); paintPressFeedback(graphics, this) }
}

private class FeedbackToggle(icon: Icon) : JToggleButton(icon) {
  override fun paintComponent(graphics: Graphics) { super.paintComponent(graphics); paintPressFeedback(graphics, this) }
}

private class BusyIcon : Icon {
  override fun getIconWidth() = 14
  override fun getIconHeight() = 14
  override fun paintIcon(component: java.awt.Component, graphics: Graphics, x: Int, y: Int) {
    val g = graphics.create() as Graphics2D
    try {
      g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON)
      g.stroke = BasicStroke(2f)
      g.color = component.foreground
      val angle = ((System.currentTimeMillis() / 8) % 360).toInt()
      g.drawArc(x + 2, y + 2, 10, 10, angle, 285)
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
    paintPressFeedback(graphics, this)
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

internal class CardRow(private val card: JComponent) : JPanel(null) {
  init { alignmentX = LEFT_ALIGNMENT; isOpaque = false; add(card) }
  override fun getPreferredSize() = Dimension(840, card.preferredSize.height)
  override fun getMaximumSize() = Dimension(Int.MAX_VALUE, preferredSize.height)
  override fun doLayout() {
    val margin = if (width >= 600) 24 else 8
    val cardWidth = minOf(840, (width - margin * 2).coerceAtLeast(0))
    card.setBounds((width - cardWidth) / 2, 0, cardWidth, card.preferredSize.height)
  }
}

internal class ForwardingScrollPane(view: JComponent, private val outer: () -> JScrollPane?) : JScrollPane(view) {
  override fun processMouseWheelEvent(event: MouseWheelEvent) {
    val bar = verticalScrollBar
    val direction = event.preciseWheelRotation
    val atEdge = bar.maximum <= bar.visibleAmount ||
      (direction < 0 && bar.value <= bar.minimum) ||
      (direction > 0 && bar.value >= bar.maximum - bar.visibleAmount)
    if (atEdge) {
      val parent = outer()
      if (parent != null) {
        val outerBar = parent.verticalScrollBar
        val movement = (direction * event.scrollAmount * outerBar.unitIncrement).toInt().let {
          if (it == 0 && direction != 0.0) if (direction > 0) 1 else -1 else it
        }
        outerBar.value = (outerBar.value + movement).coerceIn(outerBar.minimum, outerBar.maximum - outerBar.visibleAmount)
        event.consume()
        return
      }
    }
    super.processMouseWheelEvent(event)
  }
}

private class LineMarkerGutter(private val area: JTextArea) : JComponent() {
  private var marks = emptyList<Boolean>()
  fun setMarks(value: List<Boolean>) { marks = value; revalidate(); repaint() }
  override fun getPreferredSize() = Dimension(8, maxOf(area.preferredSize.height, marks.size * area.getFontMetrics(area.font).height))
  override fun paintComponent(graphics: Graphics) {
    val lineHeight = area.getFontMetrics(area.font).height
    if (lineHeight <= 0) return
    val first = (graphics.clipBounds.y / lineHeight).coerceAtLeast(0)
    val last = ((graphics.clipBounds.y + graphics.clipBounds.height) / lineHeight).coerceAtMost(marks.lastIndex)
    for (index in first..last) {
      graphics.color = if (marks[index]) Color(74, 150, 78) else Color(205, 83, 75)
      graphics.fillRoundRect(2, index * lineHeight + 2, 4, (lineHeight - 4).coerceAtLeast(2), 3, 3)
    }
  }
}

private class LineTintPainter(private val marks: List<Boolean>) : Highlighter.HighlightPainter {
  override fun paint(graphics: Graphics, start: Int, end: Int, bounds: Shape, component: JTextComponent) {
    val area = component as? JTextArea ?: return
    val lineHeight = area.getFontMetrics(area.font).height
    if (lineHeight <= 0 || marks.isEmpty()) return
    val clip = graphics.clipBounds
    val first = (clip.y / lineHeight).coerceAtLeast(0)
    val last = ((clip.y + clip.height) / lineHeight).coerceAtMost(marks.lastIndex)
    for (index in first..last) {
      if (index >= area.lineCount) break
      val line = area.modelToView2D(area.getLineStartOffset(index)) ?: continue
      graphics.color = if (marks[index]) Color(74, 150, 78, 32) else Color(205, 83, 75, 48)
      graphics.fillRect(0, line.y.toInt(), area.width, line.height.toInt().coerceAtLeast(lineHeight))
    }
  }
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
  private lateinit var cardsScroll: JScrollPane
  private val cards = mutableListOf<SampleCard>()
  private val runState = SampleRunState()
  private val expanded = mutableMapOf<String, Boolean>()
  private var mode = runCatching { CompareMode.valueOf(HelperSettings.instance().config.mode) }.getOrDefault(CompareMode.TOKENS)
  private var problem: Problem? = null
  private var cancellation = AtomicBoolean()
  private var running = false
  private var disposed = false
  private var generation = 0
  private val changed: () -> Unit = { reload(service.lastImportedId ?: problem?.id) }
  private val runAll = icon("▶", "运行全部样例") { run(null) }
  private val stop = icon("■", "取消运行") { cancellation.set(true); updateStatus("正在取消…") }
  private val add = icon("＋", "新增自定义样例") { addSample() }
  private val busyIcon = BusyIcon()
  private val busyTimer = Timer(80) {
    runAll.repaint()
    cards.forEach { it.repaintStatus() }
  }

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
    actions.add(Box.createHorizontalStrut(2)); actions.add(icon("⌫", "清理此题") { deleteProblem() })
    add(JPanel(BorderLayout(0, 4)).apply {
      add(problemTitle, BorderLayout.NORTH); add(actions, BorderLayout.SOUTH)
    }, BorderLayout.NORTH)

    val scroll = JScrollPane(cardsPanel).apply {
      border = BorderFactory.createEmptyBorder()
      horizontalScrollBarPolicy = ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER
      verticalScrollBarPolicy = ScrollPaneConstants.VERTICAL_SCROLLBAR_ALWAYS
      verticalScrollBar.unitIncrement = 18
    }
    cardsScroll = scroll
    actions.border = BorderFactory.createEmptyBorder(0, 0, 0, scroll.verticalScrollBar.preferredSize.width)
    add(scroll, BorderLayout.CENTER)
    service.listeners.add(changed)
    reload(null)
    ApplicationManager.getApplication().executeOnPooledThread {
      HelperSettings.instance().initializeCompiler()
      IdeBridge.instance().start()
      later {
        if (HelperSettings.instance().config.compiler.isBlank()) updateStatus("请选择 C++ 编译器（⚙）")
      }
    }
  }

  private fun icon(symbol: String, name: String, action: () -> Unit) = FeedbackButton(GlyphIcon(symbol)).apply {
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
    generation++; cancellation.set(true); runState.clear(); expanded.clear()
    selectProblem(id?.let { service.workspace.load(it) } ?: service.workspace.list().firstOrNull())
  }
  private fun selectProblem(value: Problem?) {
    if (value?.id != problem?.id) { generation++; cancellation.set(true); runState.clear(); expanded.clear() }
    problem = value
    problemTitle.text = value?.title ?: "无题目"
    updateStatus(if (value == null) "在浏览器题目页点击“导入题目”" else "已载入 ${value.samples.size} 组样例")
    cards.clear(); cardsPanel.removeAll()
    if (value == null) cardsPanel.add(JLabel("在浏览器题目页点击“导入题目”"))
    else value.samples.forEachIndexed { index, sample ->
      val card = SampleCard(value, sample, index + 1)
      cards.add(card); cardsPanel.add(CardRow(card)); cardsPanel.add(Box.createVerticalStrut(8))
    }
    if (value != null) cardsPanel.add(JPanel(BorderLayout()).apply {
      alignmentX = LEFT_ALIGNMENT
      maximumSize = Dimension(Int.MAX_VALUE, 30)
      add(add, BorderLayout.EAST)
    })
    refreshResults()
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
    private val stderr = JTextArea(3, 20)
    private val compileDiagnostic = JTextArea(4, 20)
    private val resultLabel = JLabel("未运行")
    private val resultPanel = JPanel().apply { layout = BoxLayout(this, BoxLayout.Y_AXIS); alignmentX = LEFT_ALIGNMENT }
    private val fields = JPanel().apply { layout = BoxLayout(this, BoxLayout.Y_AXIS) }
    private val gutters = mutableMapOf<JTextArea, LineMarkerGutter>()
    private val actualField = field("实际输出", actual)
    private val stderrField = field("标准错误", stderr)
    private val diagnosticField = field("编译诊断", compileDiagnostic)
    private val missingExpected = JLabel().apply { foreground = Color(205, 83, 75); isVisible = false }
    private val missingActual = JLabel().apply { foreground = Color(205, 83, 75); isVisible = false }
    private val runInfo = JLabel().apply { border = BorderFactory.createEmptyBorder(3, 2, 2, 0) }
    private val expander = FeedbackToggle(ExpanderIcon())
    init {
      alignmentX = LEFT_ALIGNMENT
      maximumSize = Dimension(Int.MAX_VALUE, Int.MAX_VALUE)
      border = BorderFactory.createCompoundBorder(
        BorderFactory.createLineBorder(UIManager.getColor("Component.borderColor") ?: java.awt.Color.GRAY, 2),
        BorderFactory.createEmptyBorder(8, 8, 8, 8)
      )
      val title = JPanel(BorderLayout(8, 0)).apply { preferredSize = Dimension(0, 30) }
      title.add(JPanel(GridBagLayout()).apply {
        val position = GridBagConstraints().apply { gridy = 0; anchor = GridBagConstraints.CENTER }
        add(expander.apply {
          margin = java.awt.Insets(2, 5, 2, 5)
          preferredSize = Dimension(28, 28)
          isSelected = expanded[sample.id] ?: (number == 1)
          toolTipText = "展开或折叠样例"
          accessibleContext.accessibleName = "展开或折叠 TC $number"
          addActionListener {
            expanded[sample.id] = isSelected
            fields.isVisible = isSelected
            fitHeight()
          }
        }, position.apply { gridx = 0; insets = java.awt.Insets(0, 0, 0, 8) })
        add(JLabel("TC $number${if (sample.custom) " · 自定义" else ""}"), position.apply { gridx = 1; insets = java.awt.Insets(0, 0, 0, 4) })
      }, BorderLayout.WEST)
      title.add(resultLabel.apply { minimumSize = Dimension(0, 24) }, BorderLayout.CENTER)
      title.add(JPanel(FlowLayout(FlowLayout.RIGHT, 2, 0)).apply {
        add(icon("▶", "运行此样例") { run(sample.id) })
        if (number == 1 && !sample.custom) {
          add(icon("⧉", "复制为自定义样例") { duplicate(sample) })
          add(icon("↺", "还原原始输入") { restoreInput(sample) })
        }
        if (sample.custom) add(icon("✕", "删除此自定义样例") { deleteSample(sample) })
      }, BorderLayout.EAST)
      add(title, BorderLayout.NORTH)
      fields.add(field("输入", input)); fields.add(Box.createVerticalStrut(6))
      fields.add(field("预期输出", expected)); fields.add(missingExpected); fields.add(Box.createVerticalStrut(6))
      resultPanel.add(actualField)
      resultPanel.add(missingActual)
      resultPanel.add(runInfo)
      resultPanel.add(stderrField)
      resultPanel.add(diagnosticField)
      resultPanel.isVisible = false
      fields.add(resultPanel)
      fields.isVisible = expander.isSelected
      add(fields, BorderLayout.CENTER)
      if (sample.custom || number == 1) {
        observe(input) { sample.input = input.text; runState.reset(sample.id) }
        if (sample.custom) observe(expected) { sample.output = expected.text }
      }
      fitHeight()
    }
    private fun field(label: String, area: JTextArea): JComponent {
      area.isEditable = (area === expected && sample.custom) || (area === input && (sample.custom || number == 1))
      area.font = Font(Font.MONOSPACED, Font.PLAIN, 12)
      area.accessibleContext.accessibleName = "TC $number $label"
      val gutter = if (area === expected || area === actual) LineMarkerGutter(area).also { gutters[area] = it } else null
      return JPanel(BorderLayout(0, 2)).apply {
        alignmentX = LEFT_ALIGNMENT
        maximumSize = Dimension(Int.MAX_VALUE, Int.MAX_VALUE)
        add(JLabel(label), BorderLayout.NORTH)
        add(ForwardingScrollPane(area) { cardsScroll }.apply {
          preferredSize = Dimension(160, if (area === actual) 80 else 96)
          border = BorderFactory.createLineBorder(UIManager.getColor("Component.borderColor") ?: Color.GRAY, 2)
          if (gutter != null) setRowHeaderView(gutter)
        }, BorderLayout.CENTER)
      }
    }
    private fun markLines(area: JTextArea, marks: List<Boolean>) {
      area.highlighter.removeAllHighlights()
      gutters[area]?.setMarks(marks)
      if (marks.isNotEmpty() && area.document.length > 0)
        area.highlighter.addHighlight(0, area.document.length, LineTintPainter(marks))
    }
    private fun missingText(lines: List<Int>): String {
      if (lines.isEmpty()) return ""
      val shown = lines.take(6).joinToString("、")
      return "缺失第 $shown${if (lines.size > 6) " 等 ${lines.size} " else " "}行"
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
      val result = runState.results[sample.id]
      val phase = runState.phase(sample.id)
      val outcome = when (phase) {
        SamplePhase.COMPILING -> "编译中"
        SamplePhase.RUNNING -> "运行中"
        SamplePhase.COMPILE_ERROR -> "编译错误"
        SamplePhase.CANCELLED -> "已取消"
        else -> result?.let { verdict(it, sample.output) } ?: "未运行"
      }
      resultLabel.icon = if (phase == SamplePhase.COMPILING || phase == SamplePhase.RUNNING) busyIcon else null
      resultLabel.text = when (outcome) {
        "通过" -> "✓ 通过"
        "编译中", "运行中", "未运行" -> outcome
        else -> "✕ $outcome"
      }
      resultLabel.foreground = when (outcome) {
        "通过" -> java.awt.Color(74, 150, 78)
        "未运行", "编译中", "运行中" -> UIManager.getColor("Label.foreground")
        else -> java.awt.Color(205, 83, 75)
      }
      val diagnostic = runState.diagnostic(sample.id) ?: "编译错误"
      resultLabel.toolTipText = if (phase == SamplePhase.COMPILE_ERROR) diagnostic else outcome
      if (phase == SamplePhase.COMPILE_ERROR) {
        actualField.isVisible = false; stderrField.isVisible = false; runInfo.isVisible = false
        missingExpected.isVisible = false; missingActual.isVisible = false
        markLines(expected, emptyList()); markLines(actual, emptyList())
        compileDiagnostic.text = diagnostic
        diagnosticField.isVisible = true
        resultPanel.isVisible = true
        fitHeight()
        return
      }
      if (result == null) {
        missingExpected.isVisible = false; missingActual.isVisible = false
        markLines(expected, emptyList()); markLines(actual, emptyList())
        resultPanel.isVisible = false
        fitHeight()
        return
      }
      actual.text = result.stdout
      stderr.text = result.stderr
      compileDiagnostic.text = ""
      actualField.isVisible = true; diagnosticField.isVisible = false
      stderrField.isVisible = result.stderr.isNotBlank()
      runInfo.text = "运行耗时 ${if (result.elapsedMs == 0L) "<1" else result.elapsedMs.toString()} ms · 退出码 ${result.exitCode}"
      runInfo.isVisible = true
      val comparison = OutputComparison.compare(sample.output, result.stdout, mode)
      markLines(expected, comparison.expected); markLines(actual, comparison.actual)
      missingExpected.text = missingText(comparison.missingExpected)
      missingActual.text = missingText(comparison.missingActual)
      missingExpected.isVisible = comparison.missingExpected.isNotEmpty()
      missingActual.isVisible = comparison.missingActual.isNotEmpty()
      resultPanel.isVisible = true
      fitHeight()
    }
    fun setRunning(value: Boolean) {
      input.isEditable = (sample.custom || number == 1) && !value
      expected.isEditable = sample.custom && !value
    }
    fun repaintStatus() { resultLabel.repaint() }
    fun expand() {
      expander.isSelected = true
      expanded[sample.id] = true
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
    if (running || sample.custom || problem?.samples?.firstOrNull()?.id != sample.id) return
    val p = problem ?: return
    p.samples.add(sample.copy(id = "custom-${UUID.randomUUID()}", custom = true, originalInput = null))
    service.workspace.save(p); selectProblem(p)
  }
  private fun restoreInput(sample: Sample) {
    if (running || sample.custom || problem?.samples?.firstOrNull()?.id != sample.id) return
    val card = cards.firstOrNull { it.sample.id == sample.id } ?: return
    if (sample.originalInput == null) return
    sample.restoreInput()
    if (card.input.text != sample.input) card.input.text = sample.input
    runState.reset(sample.id)
    service.workspace.save(problem ?: return)
    refreshResults()
  }
  private fun deleteSample(sample: Sample) {
    if (running || !sample.custom) return
    val p = problem ?: return
    if (Messages.showYesNoDialog(project, "删除这条自定义样例？", "删除样例", Messages.getQuestionIcon()) != Messages.YES) return
    p.samples.remove(sample); service.workspace.save(p); runState.reset(sample.id); expanded.remove(sample.id); selectProblem(p)
  }
  private fun deleteProblem() {
    if (running) return
    val p = problem ?: return
    if (Messages.showYesNoDialog(project, "解除此题与代码文件的关联并清除本次会话的样例？代码文件不会删除。", "清理题目", Messages.getQuestionIcon()) != Messages.YES) return
    service.workspace.delete(p.id); runState.clear(); reload(null)
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
    if (settings.compiler.isBlank()) { updateStatus("请选择 C++ 编译器（⚙）", true); return }
    val selected = p.samples.filter { sampleId == null || it.id == sampleId }
    if (selected.isEmpty()) return
    val snapshot = p.copy(samples = selected.map { it.copy() }.toMutableList())
    val selectedIds = selected.map { it.id }
    val current = ++generation
    cancellation = AtomicBoolean(); val taskCancel = cancellation
    running = true; runState.start(selectedIds); refreshResults()
    runState.compileDiagnostic = "正在编译…"
    cards.forEach { it.setRunning(true) }
    runAll.icon = busyIcon; runAll.disabledIcon = busyIcon; runAll.isEnabled = false
    stop.isEnabled = true; add.isEnabled = false
    busyTimer.start()
    updateStatus("正在编译并运行…")
    ApplicationManager.getApplication().executeOnPooledThread {
      val outcome = runCatching { Runner().run(snapshot, source, settings.compiler, settings.standard, settings.optimize, taskCancel,
        extraArguments = settings.extraArguments,
        onRunning = { id -> later {
          if (current == generation) { runState.running(id); refreshResults(); updateStatus("正在运行样例…") }
        } },
        onCompleted = { test -> later {
          if (current == generation) { runState.complete(test.sampleId, test.process); refreshResults() }
        } }) }
      later {
        running = false; runAll.icon = GlyphIcon("▶"); runAll.disabledIcon = null; runAll.isEnabled = true
        stop.isEnabled = false; add.isEnabled = true; busyTimer.stop()
        cards.forEach { it.setRunning(false) }
        if (current != generation) { updateStatus("题目已变化，旧运行已取消"); return@later }
        outcome.onSuccess { result ->
          runState.compileDiagnostic = "退出码：${result.compile.exitCode}\n${result.compile.failure ?: ""}\n${result.compile.stdout}\n${result.compile.stderr}"
          if (result.compile.failure != null || result.compile.exitCode != 0) {
            if (taskCancel.get()) {
              runState.cancelPending(selectedIds)
              updateStatus("已取消")
            } else {
              runState.compileError(selectedIds, runState.compileDiagnostic)
              updateStatus("编译错误（查看 TC 结果）", true)
            }
          } else {
            result.tests.forEach { runState.complete(it.sampleId, it.process) }
            runState.cancelPending(selectedIds)
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
          runState.compileError(selectedIds, it.message ?: "运行失败")
          updateStatus("运行失败（查看 TC 结果）", true)
        }
        refreshResults()
      }
    }
  }
  override fun dispose() { disposed = true; cancellation.set(true); busyTimer.stop(); service.listeners.remove(changed) }
}
