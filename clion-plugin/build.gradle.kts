import org.jetbrains.intellij.platform.gradle.IntelliJPlatformType
import org.gradle.language.jvm.tasks.ProcessResources

plugins {
  kotlin("jvm") version "2.4.20"
  id("org.jetbrains.intellij.platform") version "2.19.0"
}

group = "cn.neuoj"
version = "0.2.1-beta"
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
    } else clion("2026.2.2")
    bundledPlugin("com.intellij.clion")
    if (!providers.gradleProperty("localVerifierJar").isPresent) pluginVerifier()
  }
  testImplementation("junit:junit:4.13.2")
}
kotlin { compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_21) } }
java {
  toolchain { languageVersion.set(JavaLanguageVersion.of(21)) }
  sourceCompatibility = JavaVersion.VERSION_21
  targetCompatibility = JavaVersion.VERSION_21
}
intellijPlatform {
  // 手写 Swing 界面，不使用 .form 或额外字节码插桩。
  instrumentCode.set(false)
  pluginConfiguration {
    ideaVersion { sinceBuild = "262"; untilBuild = "262.*" }
  }
  pluginVerification {
    providers.gradleProperty("localVerifierJar").orNull?.let { cliPath.set(file(it)) }
    ides {
      val localIde = providers.gradleProperty("localIdePath").orNull
      if (localIde != null) local(localIde) else create(IntelliJPlatformType.CLion, "2026.2.2")
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
