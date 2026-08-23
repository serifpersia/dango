package com.serifpersia.dango

import android.content.Context
import android.util.AttributeSet
import android.view.MotionEvent
import android.view.ViewConfiguration
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout
import kotlin.math.abs

class DangoSwipeRefreshLayout @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
) : SwipeRefreshLayout(context, attrs) {

    private var downX = 0f
    private var downY = 0f
    private val diagonalRatio = 1.6f
    private val touchSlop = ViewConfiguration.get(context).scaledTouchSlop

    override fun onInterceptTouchEvent(ev: MotionEvent): Boolean {
        when (ev.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                downX = ev.x
                downY = ev.y
            }

            MotionEvent.ACTION_MOVE -> {
                val dx = ev.x - downX
                val dy = ev.y - downY
                if (dy > touchSlop && abs(dy) > abs(dx) * diagonalRatio) {
                    return super.onInterceptTouchEvent(ev)
                }
                if (abs(dx) > abs(dy) * diagonalRatio) {
                    return false
                }
            }
        }

        return super.onInterceptTouchEvent(ev)
    }
}
