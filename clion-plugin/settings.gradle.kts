pluginManagement {
  repositories {
    providers.gradleProperty("mavenCentralMirror").orNull?.let { maven(it) }
    gradlePluginPortal()
  }
}
rootProject.name = "neuoj-clion-helper"
