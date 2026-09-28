package cn.neuoj.helper

import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.Service
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.WindowManager
import java.awt.Window
import java.nio.file.Path
import java.nio.file.Files
import java.util.concurrent.CompletableFuture
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.TimeUnit
import javax.swing.SwingUtilities

@Service(Service.Level.PROJECT)
class ProjectWorkspace(val project: Project) {
  val workspace = Workspace()
  @Volatile var lastImportedId: String? = null
  val listeners = CopyOnWriteArrayList<() -> Unit>()
  fun changed() = ApplicationManager.getApplication().invokeLater {
    if (!project.isDisposed) listeners.forEach { it() }
  }
}

@Service(Service.Level.APP)
class IdeBridge : Disposable {
  @Volatile private var server: LocalEndpoint? = null
  @Volatile var status = "尚未启动"
    private set

  @Synchronized fun start() {
    if (server != null) return
    try {
      val created = LocalEndpoint(27121) { problem ->
        val completion = CompletableFuture<Unit>()
        ApplicationManager.getApplication().invokeLater {
          if (completion.isDone) return@invokeLater
          try {
            val manager = WindowManager.getInstance()
            val window = manager.mostRecentFocusedWindow
            val frames = manager.allProjectFrames
            val frame = frames.firstOrNull { frame ->
              val frameWindow = SwingUtilities.getWindowAncestor(frame.component)
              var current: Window? = window
              while (current != null && current != frameWindow) current = current.owner
              current != null
            }
              ?: frames.singleOrNull()
              ?: throw NoReceiverException()
            val target = frame.project ?: throw NoReceiverException()
            if (target.isDisposed) throw NoReceiverException()
            val editor = FileEditorManager.getInstance(target).selectedTextEditor ?: throw NoReceiverException()
            val file = FileDocumentManager.getInstance().getFile(editor.document) ?: throw NoReceiverException()
            if (!file.isInLocalFileSystem) throw NoReceiverException()
            val source = Path.of(file.path)
            if (!Files.isRegularFile(source)) throw NoReceiverException()
            val storage = target.getService(ProjectWorkspace::class.java)
            storage.workspace.importProblem(problem, source)
            storage.lastImportedId = problem.id
            storage.changed()
            completion.complete(Unit)
          } catch (error: Exception) { completion.completeExceptionally(error) }
        }
        try { completion.get(8, TimeUnit.SECONDS) }
        catch (error: java.util.concurrent.ExecutionException) { throw error.cause ?: error }
        catch (error: java.util.concurrent.TimeoutException) { completion.cancel(false); throw error }
      }
      created.start(); server = created
      status = "等待题目导入"
    } catch (_: Exception) { status = "导入功能启动失败，请检查端口占用。" }
  }
  override fun dispose() { server?.close() }
  companion object { fun instance(): IdeBridge = ApplicationManager.getApplication().getService(IdeBridge::class.java) }
}
