package org.readium.r2.navigator.pager

import android.os.Bundle
import android.os.Parcel
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.TextView
import androidx.fragment.app.Fragment
import androidx.fragment.app.FragmentActivity
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class R2FragmentPagerAdapterTest {

    class PageFragment : Fragment() {
        override fun onCreateView(
            inflater: LayoutInflater,
            container: ViewGroup?,
            savedInstanceState: Bundle?,
        ): View = TextView(requireContext()).apply { id = View.generateViewId() }
    }

    private class TestAdapter(activity: FragmentActivity) :
        R2FragmentPagerAdapter(activity.supportFragmentManager) {
        override fun getItem(position: Int): Fragment = PageFragment().apply {
            arguments = Bundle().apply { putString("href", "chapter-$position.xhtml") }
        }

        override fun getCount(): Int = PAGE_COUNT
    }

    @Test
    fun `saved state stays bounded however many pages were turned`() {
        val activity = Robolectric.buildActivity(FragmentActivity::class.java).setup().get()
        val container = FrameLayout(activity).apply { id = View.generateViewId() }
        activity.setContentView(container)
        val adapter = TestAdapter(activity)

        var previous: Any? = null
        for (position in 0 until PAGE_COUNT) {
            adapter.startUpdate(container)
            val page = adapter.instantiateItem(container, position)
            previous?.let { adapter.destroyItem(container, position - 1, it) }
            adapter.finishUpdate(container)
            previous = page
        }

        val state = assertNotNull(adapter.saveState() as Bundle?)
        assertNull(state.getLongArray("states"))
        assertTrue(parceledSize(state) < MAX_STATE_BYTES, "pager state was ${parceledSize(state)} bytes")
    }

    private fun parceledSize(bundle: Bundle): Int {
        val parcel = Parcel.obtain()
        return try {
            parcel.writeBundle(bundle)
            parcel.dataSize()
        } finally {
            parcel.recycle()
        }
    }

    private companion object {
        const val PAGE_COUNT = 500
        const val MAX_STATE_BYTES = 4 * 1024
    }
}
