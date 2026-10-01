import org.jetbrains.intellij.platform.gradle.IntelliJPlatformType
import org.gradle.language.jvm.tasks.ProcessResources

plugins {
  kotlin("jvm") version "2.4.20"
  id("org.jetbrains.intellij.platform") version "2.19.0"
}

group = "cn.neuoj"
version = "0.2.2-beta"
val targetPlatform = providers.gradleProperty("targetPlatform").orNull
require(targetPlatform == null || targetPlatform in setOf("macos", "linux-x64", "windows-x64")) {
  "targetPlatform 必须为 macos、linux-x64 或 windows-x64"
}
repositories {
  intellijPlatform { localPlatformArtifacts() }
  providers.gradleProperty("mavenCentralMirror").orNull?.let { maven(it) }
  mavenCentral()
  intellijPlatform { defaultRepositories() }
}
dependencies {
  intellijPlatform {
    val localIde = providers.gradleProperty("localIdePath").orNull
    if (localIde != null) {
      local(localIde)
      val bundledRuntime = file("$localIde/Contents/jbr/Contents/Home")
      if (bundledRuntime.isDirectory) jetbrainsRuntimeLocal(bundledRuntime.toPath())
    } else clion("2023.3")
    bundledPlugin("com.intellij.clion")
    if (!providers.gradleProperty("localVerifierJar").isPresent) pluginVerifier()
  }
  testImplementation("junit:junit:4.13.2")
}
kotlin {
  compilerOptions { freeCompilerArgs.add("-Xjdk-release=17") }
}
java {
  toolchain { languageVersion.set(JavaLanguageVersion.of(21)) }
  sourceCompatibility = JavaVersion.VERSION_17
  targetCompatibility = JavaVersion.VERSION_17
}
intellijPlatform {
  // 手写 Swing 界面，不使用 .form 或额外字节码插桩。
  instrumentCode.set(false)
  pluginConfiguration {
    ideaVersion { sinceBuild = "233"; untilBuild = "262.*" }
  }
  pluginVerification {
    providers.gradleProperty("localVerifierJar").orNull?.let { cliPath.set(file(it)) }
    ides {
      val localIde = providers.gradleProperty("localIdePath").orNull
      if (localIde != null) local(localIde) else {
        val selectedVersion = providers.gradleProperty("verificationIdeVersion").orNull
        for (version in selectedVersion?.let { listOf(it) } ?: listOf("2023.3", "2024.2", "2025.2", "2026.2.2")) {
          create(IntelliJPlatformType.CLion, version)
        }
      }
    }
  }
}
tasks.test {
  systemProperty("file.encoding", "UTF-8")
  systemProperty("java.awt.headless", "true")
  testLogging.exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL
}

tasks.named<ProcessResources>("processResources") {
  inputs.property("targetPlatform", targetPlatform ?: "all")
  if (targetPlatform != null) {
    for (platform in setOf("macos", "linux-x64", "windows-x64") - targetPlatform) {
      exclude("native/$platform/**")
    }
  }
}

// 开发沙箱可打开一次性的验收项目，不改变正式 IDE 配置。
tasks.runIde {
  providers.gradleProperty("uiProject").orNull?.let { args(it) }
}

tasks.withType<JavaCompile>().configureEach { options.release.set(17) }

// 平台构建插件会配置任务的 JVM 目标，因此这里显式覆盖为最低运行时版本。
tasks.withType<org.jetbrains.kotlin.gradle.tasks.KotlinCompile>().configureEach {
  compilerOptions.jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
}
