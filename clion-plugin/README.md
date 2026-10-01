# NEUOJ CLion 插件

插件支持 CLion 2023.3–2026.2，使用 2023.3 平台编译，已通过 2023.3、2024.2、2025.2、2026.2.2 的 Plugin Verifier 检查。插件使用本机编译器编译当前编辑器中的单文件 C/C++。macOS、Linux x86-64 和 Windows x86-64 的样例显示程序的 CPU 用时。支持导入题面和样例、本地测试、两种输出比较模式，以及从 CLion 正式提交代码。题目与导入时文件的关联仅在本次 CLion 会话有效。

## 构建

构建使用 JDK 21，插件字节码与 Java API 目标为 17；用户运行插件使用 IDE 自带的运行时即可，无需安装 JDK 21。无需全局安装 Gradle 或 Kotlin。以下命令均在 `clion-plugin/` 执行：

```sh
./gradlew test buildPlugin
```

Windows 可使用 `gradlew.bat test buildPlugin`。POSIX Gradle Wrapper 默认将下载的 Gradle 和 Kotlin 依赖存放在仓库根目录的 `.deps/gradle/`，该目录不会提交到 Git。已有本机安装的 CLion 时可显式指定路径：

```sh
./gradlew test buildPlugin -PlocalIdePath="/实际路径/CLion.app"
./gradlew verifyPlugin -PlocalIdePath="/实际路径/CLion.app"
```

原生计时辅助程序的源码分别位于 `native/macos/`、`native/linux/` 和 `native/windows/`。插件资源包含 macOS arm64/x86-64 通用程序，以及 Linux、Windows 的 x86-64 程序。更新源码后运行对应目录下的 `build.sh` 并提交资源文件；Linux 与 Windows 的构建脚本使用 Zig 0.14.1 交叉编译，CI 会核对产物。普通插件构建直接打包已有资源，不需要本机安装三个平台的编译器。

默认 `./gradlew verifyPlugin` 验证 CLion 2023.3、2024.2、2025.2、2026.2.2；CI 分别运行这四个目标。可用 `-PverificationIdeVersion=2025.2` 单独验证指定版本。`-PlocalIdePath` 会同时覆盖编译和验证平台，只用于本机检查，不能代替最低平台验证。

本地校验器文件可存放在 `.deps/tools/`，例如执行 `./gradlew verifyPlugin -PlocalVerifierJar=../.deps/tools/verifier-cli-1.410-all.jar -PlocalIdePath="/实际路径/CLion.app"`。未指定本地校验器时，Gradle 会按构建配置获取。测试用 CLion 项目位于 `~/workspace/cpp/neuoj-helper`，可通过 `-PuiProject="$HOME/workspace/cpp/neuoj-helper"` 传给 `runIde`。

本机真实编译闭环测试需要指定可用的 C++ 编译器路径：

```sh
NEUOJ_TEST_GXX="$(which g++)" NEUOJ_TEST_GCC="$(which gcc)" ./gradlew test --rerun-tasks -PlocalIdePath="/实际路径/CLion.app"
```

测试未提供此变量时仍运行比较、协议、工作区、进程和编译器识别测试，跳过真实编译闭环。插件 ZIP 位于 `build/distributions/`。发布时使用 `-PtargetPlatform=macos`、`-PtargetPlatform=linux-x64` 或 `-PtargetPlatform=windows-x64` 分别构建专用 ZIP，每包只包含对应平台的计时程序；不指定该参数时仍包含三平台资源。[v0.2.2-beta 预发布](https://github.com/StoneXieAC/neuoj-helper/releases/tag/v0.2.2-beta) 提供三个平台专用包。不自动安装系统编译器。

## 使用

1. 在 CLion 设置的插件页选择“从磁盘安装插件”，安装 ZIP 并重启。
2. 在 CLion 打开已有的本地代码文件及 `NEUOJ` 工具窗口。若有多个窗口，导入会使用切换到浏览器前最近使用的窗口和其中选中的文件。
3. 在 NEUOJ Helper 设置中配置编译器路径、C/C++ 标准、`-O2` 优化及可选的自定义编译参数。插件按所选语言优先探测 `gcc` 或 `g++`，也支持 Clang；未找到时可手动选择。
4. 在 NEUOJ 题目页点击“导入题目”，题目与样例会关联到当前打开的文件；切换到要测试的代码文件后点击顶部运行图标。每次运行都会读取当前选中的编辑器文件。导入功能无需配置模型 API。
5. 保持浏览器、扩展及至少一个已登录的同入口 NEUOJ 标签页打开。在 CLion 中选中关联的代码文件，点击运行、停止旁的提交图标。插件先保存文件，再显示文件名和正式提交语言；确认后提交。工具窗口顶部的原生提示栏显示提交状态：成功时提供“查看提交”，需要核对时提供“查看提交记录”，跳转到同一访问入口的记录页。提交结果不包含线上评测结论。

使用提交功能时需同时更新 CLion 插件与浏览器扩展；更新任一端后，刷新 NEUOJ 题目页并重新点击“导入题目”，建立本次会话的配对。

编译器路径、标准、优化选项和自定义编译参数为用户全局配置，会记住最近选择。默认标准为 C++14；可选 C89、C99、C11、C17、C23 和 C++98、11、14、17、20、23、26。本地编译严格使用所选标准；线上提交将全部 C 标准映射到 NEUOJ 的 C，全部 C++ 标准映射到 C++14。默认启用 `-O2`，取消勾选后编译命令不再包含该参数。自定义参数追加到默认编译命令，支持引号和反斜杠转义，不通过 shell 执行；插件不提供完整命令输入，也不自动降级标准。

顶部滑动开关可随时切换比较模式，关闭时为默认的忽略空白字符比较，开启时为逐字符比较，已有结果立即重新比较。忽略空白按 token 比较；逐字符比较只统一 CRLF 与 LF，空格、空行、末尾换行仍参与比较。预期输出和实际输出按当前模式逐行高亮；仅空白不同且 token 相同的行均标绿。点击文本框外的空白区域会退出编辑焦点，滚轮恢复滚动外层样例列表。计时结果与退出码显示在实际输出框下方，标准错误和编译诊断单独显示。三平台的“用时”为样例进程用户态加内核态 CPU 耗时，包含程序自身加载和运行时初始化，不包含编译、插件轮询或休眠等待；低于 1 ms 显示 `<1 ms`。CPU 用时只统计被包装的样例进程，不合并其自行创建的子进程。超时与取消按墙上时间判定：macOS 使用系统记录的进程启动和退出时间，Windows 从样例恢复执行时计至系统记录的退出时间；Linux 每隔约 1 ms 检查样例是否仍在运行，系统调度延迟可能扩大误差。辅助程序无法启动或当前架构没有对应资源时仍运行样例并显示“用时不可用”；计时结果损坏会报告执行错误。运行失败会显示 IDE 通知。

TC1 的官方输入和预期输出均可在本次会话中编辑；修改预期输出后，已有运行结果会立即重新比较。还原图标仅恢复本次导入时的原始输入。只有 TC1 可复制为自定义样例；自定义样例可编辑、运行和删除，并在本次会话中保留。每张卡片可单独运行，顶部可运行全部；运行前只保存当前编辑器中的代码文件。编译错误、标准不受支持、异常退出、超时与输出超限在界面中显示。编译限时 30 秒，运行限时采用题目限制，缺失时 2 秒；单样例标准输出和标准错误合计上限 1 MiB。本地运行不实施线上内存限制，也不等同于线上评测。

导入过程不会新建源码、题目目录或修改项目 CMake 配置。“清理此题”只解除关联，不删除原代码文件。重启 CLion 后需重新导入题目。编译产物放在系统临时目录，运行结束后清理。

协议见 [IDE 本地协议](../docs/ide-protocol.md)。
