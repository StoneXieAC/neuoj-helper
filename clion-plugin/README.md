# NEUOJ CLion 插件

首版面向 macOS、CLion 2026.2.2，以 GNU g++ 编译当前文件中的单文件 C++。支持导入题面和样例、本地测试及两种输出比较模式。题目与代码文件的关联仅在本次 CLion 会话有效。正式提交与代码回传尚未实现。

## 构建

使用 JDK 21，无需全局安装 Gradle 或 Kotlin。以下命令均在 `clion-plugin/` 执行：

```sh
./gradlew test buildPlugin
```

Gradle Wrapper 默认将下载的 Gradle、Kotlin 与 IntelliJ Platform 依赖存放在仓库根目录的 `.deps/gradle/`，该目录不会提交到 Git。已有本机安装的 CLion 时可显式指定路径：

```sh
./gradlew test buildPlugin -PlocalIdePath="/实际路径/CLion.app"
./gradlew verifyPlugin -PlocalIdePath="/实际路径/CLion.app"
```

本地校验器文件可存放在 `.deps/tools/`，例如执行 `./gradlew verifyPlugin -PlocalVerifierJar=../.deps/tools/verifier-cli-1.410-all.jar -PlocalIdePath="/实际路径/CLion.app"`。未指定本地校验器时，Gradle 会按构建配置获取。测试用 CLion 项目位于 `~/workspace/cpp/neuoj-helper`，可通过 `-PuiProject="$HOME/workspace/cpp/neuoj-helper"` 传给 `runIde`。

本机真实 GNU GCC 闭环测试需要指定实际路径，避免误用 Apple Clang：

```sh
NEUOJ_TEST_GXX="$(which g++-16)" ./gradlew test --rerun-tasks -PlocalIdePath="/实际路径/CLion.app"
```

测试未提供此变量时仍运行比较、协议、工作区、进程和编译器识别测试，跳过真实编译闭环。插件 ZIP 位于 `build/distributions/`。不自动安装系统编译器。

## 使用

1. 在 CLion 设置的插件页选择“从磁盘安装插件”，安装 ZIP 并重启。
2. 在 CLion 打开已有的本地代码文件及 `NEUOJ` 工具窗口。若有多个窗口，导入会使用切换到浏览器前最近使用的窗口和其中选中的文件。
3. 在 NEUOJ Helper 设置中选择 GNU g++ 文件及 C++ 标准。首次仅检测 PATH 中的 `g++`；Apple Clang 会被拒绝，未找到时须手动选择。例如本机 Homebrew `g++-16` 的路径由 `which g++-16` 获取。
4. 在 NEUOJ 题目页点击“导入题目”，题目与样例会关联到当前打开的代码文件；编辑该文件后点击顶部运行图标。导入功能无需配置模型 API。

编译器路径与标准为用户全局配置，会记住最近选择。默认标准为 C++14；可选 C++98、11、14、17、20、23、26。插件生成 `-std=c++XX -O2`，不提供完整命令输入，也不自动降级标准。

顶部滑动开关可随时切换比较模式，关闭时为默认的忽略空白字符比较，开启时为逐字符比较，已有结果立即重新比较。忽略空白按 token 比较；逐字符比较只统一 CRLF 与 LF，空格、空行、末尾换行仍参与比较。编译和运行状态会在对应 TC 中实时显示；编译错误的诊断信息也在 TC 中查看。运行失败会显示 IDE 通知。

TC1 的官方输入可临时编辑，点击还原图标可恢复本次导入时的原始输入；官方预期输出仍只读。只有 TC1 可复制为自定义样例；自定义样例可编辑、运行和删除，并在本次会话中保留。每张卡片可单独运行，顶部可运行全部；运行前只保存关联的代码文件。编译错误、标准不受支持、异常退出、超时与输出超限在界面中显示。编译限时 30 秒，运行限时采用题目限制，缺失时 2 秒；单样例标准输出和标准错误合计上限 1 MiB。本地运行不实施线上内存限制，也不等同于线上评测。

导入过程不会新建源码、题目目录或修改项目 CMake 配置。“清理此题”只解除关联，不删除原代码文件。重启 CLion 后需重新导入题目。编译产物放在系统临时目录，运行结束后清理。

协议见 [IDE 本地协议](../docs/ide-protocol.md)。
