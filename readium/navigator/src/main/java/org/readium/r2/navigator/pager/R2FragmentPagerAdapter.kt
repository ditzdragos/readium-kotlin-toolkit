/*
 * Module: r2-navigator-kotlin
 * Developers: Aferdita Muriqi, Clément Baumann, Mostapha Idoubihi, Paul Stoica
 *
 * Copyright (c) 2018. Readium Foundation. All rights reserved.
 * Use of this source code is governed by a BSD-style license which is detailed in the
 * LICENSE file present in the project repository where this source code is maintained.
 */

package org.readium.r2.navigator.pager

import android.annotation.SuppressLint
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.Parcelable
import android.view.Choreographer
import android.view.View
import android.view.ViewGroup
import androidx.collection.LongSparseArray
import androidx.fragment.app.Fragment
import androidx.fragment.app.FragmentManager
import androidx.fragment.app.FragmentTransaction

// This class will be going away when the navigator is rewritten
@Suppress("DEPRECATION")
internal abstract class R2FragmentPagerAdapter(private val mFragmentManager: FragmentManager) :
    androidx.fragment.app.FragmentStatePagerAdapter(
        mFragmentManager,
        BEHAVIOR_RESUME_ONLY_CURRENT_FRAGMENT
    ) {

    val mFragments = LongSparseArray<Fragment>()
    private val mSavedStates = LongSparseArray<Fragment.SavedState>()
    private var mCurTransaction: FragmentTransaction? = null
    private var mCurrentPrimaryItem: Fragment? = null

    /** Neighbour fragments added by a transaction that has not been committed yet. */
    private val pendingFragments = LongSparseArray<Fragment>()

    /** Built fragments removed by the transaction that has not been committed yet. */
    private val pendingRemovals = ArrayList<Fragment>()
    private val mainHandler = Handler(Looper.getMainLooper())
    private var offscreenCommitScheduled = false

    /**
     * While true, transactions that only create or destroy pages next to the visible one wait,
     * so an animation over the pager does not stall on building a web view.
     */
    var holdOffscreenPages = false
        set(value) {
            field = value
            if (!value) scheduleOffscreenCommit()
        }

    abstract override fun getItem(position: Int): Fragment

    override fun startUpdate(container: ViewGroup) {
        if (container.id == View.NO_ID) {
            throw IllegalStateException("ViewPager with adapter $this requires a view id")
        }
    }

    @SuppressLint("CommitTransaction")
    override fun instantiateItem(container: ViewGroup, position: Int): Any {
        val tag = getItemId(position)
        var fragment: Fragment? = mFragments.get(tag) ?: pendingFragments.get(tag)

        if (fragment != null) {
            return fragment
        }

        if (mCurTransaction == null) {
            mCurTransaction = mFragmentManager.beginTransaction()
        }

        fragment = getItem(position)

        val savedState = mSavedStates.get(tag)
        if (savedState != null) {
            fragment.setInitialSavedState(savedState)
        }
        fragment.setMenuVisibility(false)
        fragment.userVisibleHint = false
        pendingFragments.put(tag, fragment)
        mCurTransaction!!.add(container.id, fragment, "f$tag")

        return fragment
    }

    @SuppressLint("CommitTransaction")
    override fun destroyItem(container: ViewGroup, position: Int, `object`: Any) {
        val fragment = `object` as Fragment
        val pendingIndex = pendingFragments.indexOfValue(fragment)
        if (pendingIndex != -1) {
            pendingFragments.removeAt(pendingIndex)
            mCurTransaction?.remove(fragment)
            return
        }
        val currentPosition = getItemPosition(fragment)

        val index = mFragments.indexOfValue(fragment)
        var fragmentKey: Long = -1
        if (index != -1) {
            fragmentKey = mFragments.keyAt(index)
            mFragments.removeAt(index)
        }

        if (fragment.isAdded && currentPosition != POSITION_NONE) {
            mFragmentManager.saveFragmentInstanceState(fragment)?.let { state ->
                mSavedStates.put(fragmentKey, state)
            }
        } else {
            mSavedStates.remove(fragmentKey)
        }

        if (mCurTransaction == null) {
            mCurTransaction = mFragmentManager.beginTransaction()
        }

        mCurTransaction!!.remove(fragment)
        pendingRemovals += fragment
    }

    override fun setPrimaryItem(container: ViewGroup, position: Int, `object`: Any) {
        val fragment = `object` as Fragment?
        if (fragment !== mCurrentPrimaryItem) {
            if (mCurrentPrimaryItem != null) {
                mCurrentPrimaryItem!!.setMenuVisibility(false)
                mCurrentPrimaryItem!!.userVisibleHint = false
            }
            if (fragment != null) {
                fragment.setMenuVisibility(true)
                fragment.userVisibleHint = true
            }
            mCurrentPrimaryItem = fragment
        }
    }

    /**
     * Commits at once when the visible page is new; otherwise only neighbours changed, and they
     * are built after the visible page has drawn, so a turn into the next resource is not held
     * up by creating the one after it.
     */
    override fun finishUpdate(container: ViewGroup) {
        mCurTransaction ?: return
        val primary = mCurrentPrimaryItem
        if (primary != null && primary.isAdded && pendingFragments.indexOfValue(primary) == -1) {
            scheduleOffscreenCommit()
        } else {
            commitPending()
        }
    }

    private fun scheduleOffscreenCommit() {
        if (holdOffscreenPages || offscreenCommitScheduled || mCurTransaction == null) return
        offscreenCommitScheduled = true
        afterFrames(OFFSCREEN_COMMIT_FRAMES) {
            mainHandler.post {
                offscreenCommitScheduled = false
                if (!holdOffscreenPages) commitPending()
            }
        }
    }

    private fun afterFrames(count: Int, action: () -> Unit) {
        Choreographer.getInstance().postFrameCallback {
            if (count <= 1) action() else afterFrames(count - 1, action)
        }
    }

    private fun commitPending() {
        val transaction = mCurTransaction ?: return
        mCurTransaction = null
        for (i in 0 until pendingFragments.size()) {
            mFragments.put(pendingFragments.keyAt(i), pendingFragments.valueAt(i))
        }
        pendingFragments.clear()
        pendingRemovals.clear()
        if (!mFragmentManager.isDestroyed) transaction.commitNowAllowingStateLoss()
    }

    /**
     * Drops a transaction still waiting to be committed. Its neighbours were never built, but the
     * pages it removes still have to go, or they stay added with their web views.
     */
    protected fun discardPending() {
        mCurTransaction = null
        pendingFragments.clear()
        val removals = pendingRemovals.filter { it.isAdded }
        pendingRemovals.clear()
        if (removals.isEmpty() || mFragmentManager.isDestroyed) return
        mFragmentManager.beginTransaction()
            .apply { removals.forEach { remove(it) } }
            .commitNowAllowingStateLoss()
    }

    /** The fragment at [position], whether committed or still waiting to be. */
    fun fragmentAt(position: Int): Fragment? =
        getItemId(position).let { mFragments.get(it) ?: pendingFragments.get(it) }

    override fun isViewFromObject(view: View, `object`: Any): Boolean {
        return (`object` as Fragment).view === view
    }

    // Destroyed pages' states are kept in memory only: one per page turned would grow the
    // parcel past the binder limit (TransactionTooLargeException on stop), and the navigator
    // restores its position from its own locator anyway.
    override fun saveState(): Parcelable? {
        var state: Bundle? = null
        for (i in 0 until mFragments.size()) {
            val f = mFragments.valueAt(i)
            if (f.isAdded) {
                if (state == null) {
                    state = Bundle()
                }
                val key = "f" + mFragments.keyAt(i)
                mFragmentManager.putFragment(state, key, f)
            }
        }
        return state
    }

    override fun restoreState(state: Parcelable?, loader: ClassLoader?) {
        if (state != null) {
            val bundle = state as Bundle?
            bundle!!.classLoader = loader
            mSavedStates.clear()
            mFragments.clear()
            discardPending()
            val keys = bundle.keySet()
            for (key in keys) {
                if (key.startsWith("f")) {
                    val f = mFragmentManager.getFragment(bundle, key)
                    if (f != null) {
                        f.setMenuVisibility(false)
                        mFragments.put(java.lang.Long.parseLong(key.substring(1)), f)
                    }
                }
            }
        }
    }

    fun getItemId(position: Int): Long {
        return position.toLong()
    }

    private companion object {
        const val OFFSCREEN_COMMIT_FRAMES = 2
    }
}
