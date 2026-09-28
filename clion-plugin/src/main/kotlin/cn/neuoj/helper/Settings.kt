package cn.neuoj.helper

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.*
import com.intellij.openapi.options.Configurable
import com.intellij.openapi.options.ConfigurationException
import com.intellij.openapi.ui.TextFieldWithBrowseButton
import com.intellij.openapi.fileChooser.FileChooserDescriptorFactory
import java.awt.GridLayout
import javax.swing.*

@State(name = "NeuojHelperSettings", storages = [Storage("neuoj-helper.xml")])
@Service(Service.Level.APP)
class HelperSettings : PersistentStateComponent<HelperSettings.Values> {
  data class Values(var compiler: String = "", var standard: String = "C++14", var detectionDone: Boolean = false, var port: Int = 27121, var mode: String = "TOKENS")
  private var values = Values()
  val config: Values get() = values
  override fun getState() = values
  override fun loadState(state: Values) { values = state }
  @Synchronized fun initializeCompiler() {
    if (values.detectionDone || values.compiler.isNotBlank()) return
    values.detectionDone = true
    values.compiler = Compiler.detect() ?: ""
  }
  companion object { fun instance(): HelperSettings = ApplicationManager.getApplication().getService(HelperSettings::class.java) }
}

class HelperConfigurable : Configurable {
  private val compiler = TextFieldWithBrowseButton()
  private val standard = JComboBox(Compiler.standards.toTypedArray())
  private val port = JSpinner(SpinnerNumberModel(27121, 1024, 65535, 1))
  override fun getDisplayName() = "NEUOJ Helper"
  override fun createComponent(): JComponent {
    compiler.addBrowseFolderListener(null, FileChooserDescriptorFactory.createSingleFileDescriptor().withTitle("选择 GNU g++ 可执行文件"))
    return JPanel(GridLayout(0, 1, 6, 6)).apply {
      add(JLabel("编译器路径（GNU g++）")); add(compiler)
      add(JLabel("C++ 标准")); add(standard)
      add(JLabel("IDE 连接端口")); add(port)
      add(JLabel("未找到 GNU g++ 时请手动选择；不会回退到 Clang。"))
    }.also { reset() }
  }
  override fun isModified(): Boolean {
    val state = HelperSettings.instance().config
    return compiler.text != state.compiler || standard.selectedItem != state.standard || port.value != state.port
  }
  override fun reset() {
    val state = HelperSettings.instance().config
    compiler.text = state.compiler; standard.selectedItem = state.standard; port.value = state.port
  }
  override fun apply() {
    try {
      // 设置验证由同步后台任务执行，避免在事件线程启动编译器。
      val error = java.util.concurrent.atomic.AtomicReference<Throwable?>()
      val completed = com.intellij.openapi.progress.ProgressManager.getInstance().runProcessWithProgressSynchronously(Runnable {
        try { if (compiler.text.isNotBlank()) Compiler.validate(compiler.text) } catch (e: Exception) { error.set(e) }
      }, "验证 GNU g++", true, null)
      if (!completed) throw ConfigurationException("已取消保存设置。")
      error.get()?.let { throw ConfigurationException(it.message ?: "编译器验证失败。") }
      val state = HelperSettings.instance().config
      val oldPort = state.port
      state.compiler = compiler.text; state.standard = standard.selectedItem as String
      state.port = port.value as Int; state.detectionDone = true
      if (oldPort != state.port) IdeBridge.instance().restart()
    } catch (e: ConfigurationException) { throw e }
    catch (e: Exception) { throw ConfigurationException(e.message ?: "保存设置失败。") }
  }
}
