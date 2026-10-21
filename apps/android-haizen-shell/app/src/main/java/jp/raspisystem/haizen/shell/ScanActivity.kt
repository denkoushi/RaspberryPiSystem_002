package jp.raspisystem.haizen.shell

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.util.Log
import android.view.Gravity
import android.view.HapticFeedbackConstants
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ExperimentalGetImage
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.core.UseCaseGroup
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import android.util.Size
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions

class ScanActivity : ComponentActivity() {
    private lateinit var preview: PreviewView
    private lateinit var guide: GuideView
    private lateinit var resultText: TextView
    private lateinit var rawText: TextView
    private lateinit var cameraButton: Button
    private val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
    private val uiExecutor by lazy { ContextCompat.getMainExecutor(this) }
    private var cameraProvider: ProcessCameraProvider? = null
    private var analysis: ImageAnalysis? = null
    private val confirmer = ConsecutiveConfirmer(2)
    private var generation = 0
    private var inFlight = false
    private var destroyed = false
    private var hasConfirmation = false

    private val permissionRequest = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) {
            cameraButton.visibility = View.GONE
            preview.post { startCamera() }
        } else {
            resultText.text = "カメラ権限が必要です"
            rawText.text = "権限を許可してください。再表示されない場合は端末の設定で許可します。"
            cameraButton.visibility = View.VISIBLE
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        val root = FrameLayout(this)
        preview = PreviewView(this).apply {
            scaleType = PreviewView.ScaleType.FILL_CENTER
            implementationMode = PreviewView.ImplementationMode.COMPATIBLE
        }
        root.addView(preview, FrameLayout.LayoutParams(-1, -1))
        guide = GuideView(this)
        root.addView(guide, FrameLayout.LayoutParams(-1, -1))

        val header = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(12), dp(16), dp(12))
            setBackgroundColor(0xCC000000.toInt())
        }
        resultText = label(32f).apply {
            accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE
        }
        header.addView(resultText)
        root.addView(header, FrameLayout.LayoutParams(-1, -2, Gravity.TOP))

        val footer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(8), dp(16), dp(12))
            setBackgroundColor(0xCC000000.toInt())
        }
        rawText = label(13f).apply { maxLines = 3 }
        footer.addView(rawText)
        cameraButton = Button(this).apply {
            text = "カメラを許可"
            visibility = View.GONE
            setOnClickListener { permissionRequest.launch(Manifest.permission.CAMERA) }
        }
        footer.addView(cameraButton)
        footer.addView(Button(this).apply {
            text = "やめる"
            textSize = 24f
            minHeight = dp(64)
            setOnClickListener { finish() }
        })
        root.addView(footer, FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM))
        setContentView(root)
        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            permissionRequest.launch(Manifest.permission.CAMERA)
        }
    }

    override fun onStart() {
        super.onStart()
        resetReading()
        if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            cameraButton.visibility = View.GONE
            preview.post { startCamera() }
        }
    }

    override fun onStop() {
        generation++ // Discard OCR that finishes after leaving the screen.
        analysis?.clearAnalyzer()
        cameraProvider?.unbindAll()
        super.onStop()
    }

    override fun onDestroy() {
        destroyed = true
        // An outstanding task owns its image and recognizer until completion.
        if (!inFlight) recognizer.close()
        super.onDestroy()
    }

    private fun resetReading() {
        generation++
        confirmer.reset()
        hasConfirmation = false
        resultText.text = "読み取り中…"
        rawText.text = "認識トークン: —"
    }

    private fun startCamera() {
        if (destroyed || !lifecycle.currentState.isAtLeast(androidx.lifecycle.Lifecycle.State.STARTED)) return
        val future = ProcessCameraProvider.getInstance(this)
        future.addListener({
            if (destroyed || !lifecycle.currentState.isAtLeast(androidx.lifecycle.Lifecycle.State.STARTED)) return@addListener
            try {
                val provider = future.get()
                cameraProvider = provider
                val viewPort = preview.viewPort ?: return@addListener
                val cameraPreview = Preview.Builder().build().also {
                    it.setSurfaceProvider(preview.surfaceProvider)
                }
                val imageAnalysis = ImageAnalysis.Builder()
                    .setTargetRotation(preview.display.rotation)
                    // The 640x480 default is too coarse for small printed 製番 characters.
                    .setResolutionSelector(ResolutionSelector.Builder().setResolutionStrategy(
                        ResolutionStrategy(Size(1280, 720),
                            ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER)
                    ).build())
                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                    .build()
                imageAnalysis.setAnalyzer(uiExecutor) { analyze(it) }
                analysis?.clearAnalyzer()
                provider.unbindAll()
                // Both use cases see the same sensor region, even with different resolutions.
                val group = UseCaseGroup.Builder().setViewPort(viewPort)
                    .addUseCase(cameraPreview).addUseCase(imageAnalysis).build()
                provider.bindToLifecycle(this, CameraSelector.DEFAULT_BACK_CAMERA, group)
                analysis = imageAnalysis
            } catch (error: Exception) {
                resultText.text = "カメラを開始できません"
                rawText.text = "アプリを開き直してください"
                Log.e(TAG, "Camera startup failed", error)
            }
        }, uiExecutor)
    }

    @androidx.annotation.OptIn(ExperimentalGetImage::class)
    private fun analyze(imageProxy: ImageProxy) {
        if (destroyed || inFlight || hasConfirmation) {
            imageProxy.close()
            return
        }
        val mediaImage = imageProxy.image
        if (mediaImage == null || preview.width == 0 || preview.height == 0) {
            imageProxy.close()
            return
        }
        val frameGeneration = generation
        val roi = guideInImage(imageProxy)
        inFlight = true
        try {
            recognizer.process(InputImage.fromMediaImage(mediaImage, imageProxy.imageInfo.rotationDegrees))
                .addOnSuccessListener(uiExecutor) { recognized ->
                    if (!destroyed && generation == frameGeneration) {
                        // ML Kit boxes use the full image after rotation. Keep only complete
                        // elements inside the guide; adjacent columns cannot contribute tokens.
                        val lines = recognized.textBlocks.flatMap { it.lines }.map { line ->
                            line.elements.filter { element ->
                                element.boundingBox?.let { roi.contains(RectF(it)) } == true
                            }.joinToString(" ") { it.text }
                        }
                        val tokens = FseibanTokenRule.extract(lines.joinToString("\n"))
                        rawText.text = "認識トークン: ${tokens.joinToString(", ").ifEmpty { "—" }}"
                        val now = SystemClock.elapsedRealtime()
                        confirmer.feed(tokens, now)?.let { showConfirmation(it, tokens, recognized.text) }
                    }
                }
                .addOnFailureListener(uiExecutor) { error ->
                    if (!destroyed && generation == frameGeneration) {
                        // A failed analysis cannot bridge two otherwise consecutive sightings.
                        confirmer.feed(emptyList(), SystemClock.elapsedRealtime())
                        rawText.text = "認識エラー。再試行中…"
                        Log.w(TAG, "OCR failed", error)
                    }
                }
                .addOnCompleteListener(uiExecutor) {
                    imageProxy.close()
                    inFlight = false
                    if (destroyed) recognizer.close()
                }
        } catch (error: Exception) {
            // Synchronous input/setup failures have no Task completion callback.
            imageProxy.close()
            inFlight = false
            confirmer.feed(emptyList(), SystemClock.elapsedRealtime())
            rawText.text = "認識エラー。再試行中…"
            Log.w(TAG, "OCR input failed", error)
        }
    }

    private fun guideInImage(image: ImageProxy): RectF {
        val crop = image.cropRect
        val w = image.width.toFloat()
        val h = image.height.toFloat()
        // Rotate the viewport crop into ML Kit's upright, full-image coordinates.
        val upright = when (image.imageInfo.rotationDegrees) {
            90 -> RectF(h - crop.bottom, crop.left.toFloat(), h - crop.top, crop.right.toFloat())
            180 -> RectF(w - crop.right, h - crop.bottom, w - crop.left, h - crop.top)
            270 -> RectF(crop.top.toFloat(), w - crop.right, crop.bottom.toFloat(), w - crop.left)
            else -> RectF(crop)
        }
        val box = guide.bounds()
        // Account for any rounding in CameraX's shared FILL_CENTER viewport crop.
        val scale = maxOf(preview.width / upright.width(), preview.height / upright.height())
        val offsetX = (preview.width - upright.width() * scale) / 2f
        val offsetY = (preview.height - upright.height() * scale) / 2f
        return RectF(
            upright.left + (box.left - offsetX) / scale,
            upright.top + (box.top - offsetY) / scale,
            upright.left + (box.right - offsetX) / scale,
            upright.top + (box.bottom - offsetY) / scale
        )
    }

    private fun showConfirmation(confirmation: Confirmation, tokens: List<String>, text: String) {
        hasConfirmation = true
        resultText.text = confirmation.value
        // View haptics respect the device's haptic setting.
        resultText.performHapticFeedback(
            if (Build.VERSION.SDK_INT >= 30) HapticFeedbackConstants.CONFIRM
            else HapticFeedbackConstants.LONG_PRESS
        )
        setResult(RESULT_OK, Intent()
            .putExtra("fseiban", confirmation.value)
            // The server treats tokens[0] as the raw reading, so the confirmed value goes first.
            .putStringArrayListExtra("tokens", ArrayList(listOf(confirmation.value) + (tokens - confirmation.value)))
            .putExtra("text", text))
        finish()
    }

    private fun label(size: Float) = TextView(this).apply {
        textSize = size
        setTextColor(Color.WHITE)
        gravity = Gravity.CENTER
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    private class GuideView(context: android.content.Context) : View(context) {
        private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.YELLOW
            style = Paint.Style.STROKE
            strokeWidth = 3 * resources.displayMetrics.density
        }
        init { importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO }
        fun bounds() = RectF(width * 0.08f, height * 0.42f, width * 0.92f, height * 0.58f)
        override fun onDraw(canvas: Canvas) {
            super.onDraw(canvas)
            canvas.drawRect(bounds(), paint)
        }
    }

    companion object { private const val TAG = "HaizenScan" }
}
