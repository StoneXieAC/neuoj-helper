package cn.neuoj.helper

import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.PathManager
import com.intellij.openapi.components.Service
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.openapi.fileEditor.FileEditorManager
import java.nio.file.Path
import java.util.concurrent.CopyOnWriteArrayList

@Service(Service.Level.PROJECT)
class ProjectWorkspace(val project: Project) {
  val workspace = Workspace(Path.of(PathManager.getConfigPath(), "neuoj-workspaces", digest(project.basePath ?: project.locationHash)))
  @Volatile var lastImportedId: String? = null
  val listeners = CopyOnWriteArrayList<() -> Unit>()
  fun changed() = ApplicationManager.getApplication().invokeLater {
    if (!project.isDisposed) listeners.forEach { it() }
  }
}

@Service(Service.Level.APP)
class IdeBridge : Disposable {
  @Volatile private var server: LocalEndpoint? = null
  @Volatile var receiver: Project? = null
    private set
  @Volatile var status = "尚未启动连接"
    private set
  @Synchronized fun select(project: Project) {
    receiver = project
    if (server == null) restart()
  }
  @Synchronized fun restart() {
    server?.close(); server = null
    try {
      val created = LocalEndpoint(HelperSettings.instance().config.port) { problem ->
        val target = receiver
        if (target == null || target.isDisposed) throw NoReceiverException()
        val storage = target.getService(ProjectWorkspace::class.java)
        val source = storage.workspace.importProblem(problem)
        storage.lastImportedId = problem.id
        storage.changed()
        ApplicationManager.getApplication().invokeLater {
          if (!target.isDisposed) LocalFileSystem.getInstance().refreshAndFindFileByNioFile(source)?.let {
            FileEditorManager.getInstance(target).openFile(it, true)
          }
        }
      }
      created.start(); server = created
      status = "监听 127.0.0.1:${created.port}"
    } catch (_: Exception) { status = "连接启动失败，请检查端口占用。" }
  }
  override fun dispose() { server?.close() }
  companion object { fun instance(): IdeBridge = ApplicationManager.getApplication().getService(IdeBridge::class.java) }
}
