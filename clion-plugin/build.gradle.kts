import org.jetbrains.intellij.platform.gradle.IntelliJPlatformType

plugins {
  kotlin("jvm") version "2.4.20"
  id("org.jetbrains.intellij.platform") version "2.19.0"
}

group = "cn.neuoj"
version = "0.1.0"
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
tasks.test { systemProperty("file.encoding", "UTF-8") }

// 开发沙箱可打开一次性的验收项目，不改变正式 IDE 配置。
tasks.runIde {
  providers.gradleProperty("uiProject").orNull?.let { args(it) }
}
