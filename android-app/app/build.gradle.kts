plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.serifpersia.dango"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.serifpersia.dango"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"
    }

    signingConfigs {
        create("release") {
            storeFile = rootProject.file("dango-debug.keystore")
            storePassword = "dango123"
            keyAlias = "dango"
            keyPassword = "dango123"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("release")
        }
        debug {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    sourceSets {
        getByName("main") {
            assets.srcDirs("src/main/assets")
            jniLibs.srcDir(layout.buildDirectory.dir("generated/nodeLib"))
        }
    }
}

val nodeSource = rootProject.projectDir.toPath().resolve("payload/bin/node")
val generatedNodeLibDir = layout.buildDirectory.dir("generated/nodeLib/arm64-v8a")

tasks.register("syncPayload") {
    val payloadDir = rootProject.projectDir.toPath().resolve("payload")
    val assetsPayloadDir = projectDir.toPath().resolve("src/main/assets/payload")
    description = "Copy Termux node payload into APK assets"
    group = "dango"

    onlyIf { payloadDir.toFile().exists() }

    doLast {
        assetsPayloadDir.toFile().deleteRecursively()
        payloadDir.toFile().copyRecursively(assetsPayloadDir.toFile())
        println("Payload synced: ${payloadDir} -> ${assetsPayloadDir}")
    }
}

tasks.register<Copy>("syncNodeBinary") {
    dependsOn("syncPayload")
    description = "Copy the Termux node binary into generated jniLibs as libnode.so"
    group = "dango"

    from(nodeSource)
    into(generatedNodeLibDir)
    rename { "libnode.so" }

    onlyIf { nodeSource.toFile().exists() }

    doFirst {
        generatedNodeLibDir.get().asFile.deleteRecursively()
    }
}

tasks.register("generateManifest") {
    val assetsPayloadDir = projectDir.toPath().resolve("src/main/assets/payload")
    val manifestFile = assetsPayloadDir.resolve("manifest.txt")
    description = "Generate manifest.txt listing all payload files (workaround for assets.list() __-prefix bug)"
    group = "dango"

    dependsOn("syncPayload")
    inputs.dir(assetsPayloadDir)
    outputs.file(manifestFile)

    doLast {
        val files = assetsPayloadDir.toFile().walkTopDown()
            .filter { it.isFile }
            .map { "payload/" + it.relativeTo(assetsPayloadDir.toFile()).path.replace('\\', '/') }
            .sorted()
            .toList()
        manifestFile.toFile().writeText(files.joinToString("\n"))
        println("Manifest generated: ${files.size} files -> $manifestFile")
    }
}

tasks.named("preBuild") {
    dependsOn("syncNodeBinary")
    dependsOn("generateManifest")
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("androidx.swiperefreshlayout:swiperefreshlayout:1.1.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.lifecycle:lifecycle-service:2.8.7")
}
