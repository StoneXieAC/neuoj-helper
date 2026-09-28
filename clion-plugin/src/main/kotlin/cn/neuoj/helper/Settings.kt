package cn.neuoj.helper

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.*
import com.intellij.openapi.options.Configurable
import com.intellij.openapi.options.ConfigurationException
import com.intellij.openapi.ui.ComboBox
import com.intellij.openapi.ui.TextFieldWithBrowseButton
import com.intellij.openapi.fileChooser.FileChooserDescriptorFactory
import com.intellij.ui.components.JBCheckBox
import com.intellij.ui.dsl.builder.AlignX
import com.intellij.ui.dsl.builder.panel
import com.intellij.util.ui.JBUI
import java.awt.Dimension
import javax.swing.*
import javax.swing.event.DocumentEvent
import javax.swing.event.DocumentListener

@State(name = "NeuojHelperSettings", storages = [Storage("neuoj-helper.xml")])
@Service(Service.Level.APP)
class HelperSettings : PersistentStateComponent<HelperSettings.Values> {
  data class Values(var compiler: String = "", var standard: String = "C++14", var optimize: Boolean = true, var mode: String = "TOKENS")
  private var values = Values()
  val config: Values get() = values
  override fun getState() = values
  override fun loadState(state: Values) { values = state }
  fun initializeCompiler(path: String = System.getenv("PATH") ?: ""): String {
    val current = synchronized(this) { values.compiler }
    if (current.isNotBlank() && runCatching { Compiler.validate(current) }.isSuccess) return current
    val detected = Compiler.detect(path) ?: ""
    synchronized(this) {
      if (values.compiler == current) values.compiler = detected
      return values.compiler
    }
  }
  @Synchronized fun saveCompiler(compiler: String, standard: String, optimize: Boolean) {
    values.compiler = compiler; values.standard = standard; values.optimize = optimize
  }
  companion object { fun instance(): HelperSettings = ApplicationManager.getApplication().getService(HelperSettings::class.java) }
}

class HelperConfigurable : Configurable {
  private val compiler = TextFieldWithBrowseButton()
  private val standard = ComboBox(Compiler.standards.toTypedArray())
  private val optimize = JBCheckBox("启用 -O2 优化")
  private var compilerRevision = 0
  private var content: JComponent? = null
  private var browseAdded = false
  init {
    compiler.textField.document.addDocumentListener(object : DocumentListener {
      override fun insertUpdate(event: DocumentEvent) { compilerRevision++ }
      override fun removeUpdate(event: DocumentEvent) { compilerRevision++ }
      override fun changedUpdate(event: DocumentEvent) { compilerRevision++ }
    })
  }
  override fun getDisplayName() = "NEUOJ Helper"
  override fun createComponent(): JComponent {
    content?.let { return it }
    if (!browseAdded) {
      compiler.addBrowseFolderListener(null, FileChooserDescriptorFactory.createSingleFileDescriptor().withTitle("选择 C++ 编译器文件"))
      browseAdded = true
    }
    compiler.preferredSize = Dimension(JBUI.scale(360), compiler.preferredSize.height)
    val form = panel {
      row("编译器路径:") { cell(compiler).align(AlignX.LEFT).comment("推荐使用 GNU GCC/G++") }
      row("C++ 标准:") { cell(standard).align(AlignX.LEFT) }
      row { cell(optimize) }
    }
    content = form
    reset()
    return form
  }
  private fun detectCompiler() {
    val originalText = compiler.text
    val revision = compilerRevision
    ApplicationManager.getApplication().executeOnPooledThread {
      val detected = HelperSettings.instance().initializeCompiler()
      ApplicationManager.getApplication().invokeLater {
        if (content != null && compilerRevision == revision && compiler.text == originalText) compiler.text = detected
      }
    }
  }
  override fun isModified(): Boolean {
    val state = HelperSettings.instance().config
    return compiler.text != state.compiler || standard.selectedItem != state.standard || optimize.isSelected != state.optimize
  }
  override fun reset() {
    val state = HelperSettings.instance().config
    compiler.text = state.compiler; standard.selectedItem = state.standard; optimize.isSelected = state.optimize
    if (content != null) detectCompiler()
  }
  override fun disposeUIResources() { content = null; compilerRevision++ }
  override fun apply() {
    try {
      // 设置验证由同步后台任务执行，避免在事件线程启动编译器。
      val error = java.util.concurrent.atomic.AtomicReference<Throwable?>()
      val completed = com.intellij.openapi.progress.ProgressManager.getInstance().runProcessWithProgressSynchronously(Runnable {
        try { if (compiler.text.isNotBlank()) Compiler.validate(compiler.text) } catch (e: Exception) { error.set(e) }
      }, "验证 C++ 编译器", true, null)
      if (!completed) throw ConfigurationException("已取消保存设置。")
      error.get()?.let { throw ConfigurationException(it.message ?: "编译器验证失败。") }
      HelperSettings.instance().saveCompiler(compiler.text, standard.selectedItem as String, optimize.isSelected)
    } catch (e: ConfigurationException) { throw e }
    catch (e: Exception) { throw ConfigurationException(e.message ?: "保存设置失败。") }
  }
}
