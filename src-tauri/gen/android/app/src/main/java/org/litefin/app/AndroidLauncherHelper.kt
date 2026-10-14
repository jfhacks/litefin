package org.litefin.app

import android.content.ContentUris
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.content.pm.ShortcutInfo
import android.content.pm.ShortcutManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.media.tv.TvContract
import android.net.Uri
import android.os.Build
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.Executors

/**
 * =============================================================================
 * Litefin - Android Launcher & TV Home Screen Manager
 * =============================================================================
 * Bridges Litefin's Continue Watching and Next Up rows directly into native
 * Android launchers across TV and mobile form factors:
 *
 * 1. Android TV & Google TV "Play Next" (Watch Next) System Row:
 *    - Populates [TvContract.WatchNextPrograms] so that in-progress media
 *      and upcoming TV episodes appear prominently on the TV home screen.
 *    - Syncs engagement timestamps to maintain accurate chronological ordering.
 *
 * 2. Android TV Dedicated Preview Channels:
 *    - Establishes and manages a dedicated Litefin channel via [TvContract.Channels]
 *      and publishes content cards to [TvContract.PreviewPrograms].
 *    - Automatically requests browsable channel visibility on Android 8.0+.
 *
 * 3. Mobile & Tablet Dynamic Launcher Shortcuts:
 *    - Publishes up to 4 dynamic shortcuts via [ShortcutManager] on Android 7.1+
 *      allowing phone users to long-press the app icon and jump into recent media.
 *
 * 4. Deep Link Dispatch:
 *    - Generates and parses deep-link intents (litefin://item/{id}) to launch
 *      directly into content details while establishing proper back breadcrumbs.
 * =============================================================================
 */
class AndroidLauncherHelper(private val activity: MainActivity) {

  companion object {
    private const val TAG = "AndroidLauncherHelper"

    // Unique internal provider ID for Litefin's dedicated TV preview channel
    private const val CHANNEL_INTERNAL_ID = "litefin_channel_continue_watching"

    // Display title of the channel shown on Android TV home screen
    private const val CHANNEL_DISPLAY_NAME = "Litefin - Continue Watching"
  }

  // ---------------------------------------------------------------------------
  // Background Worker Pool
  // ---------------------------------------------------------------------------
  // Dedicated single-thread executor ensuring all ContentResolver disk & IPC
  // operations execute strictly off the main UI thread, preventing dropped frames.
  private val executor = Executors.newSingleThreadExecutor()

  // Convenient reference to application context
  private val context: Context get() = activity.applicationContext

  /**
   * Internal data representation of a media item destined for the launcher.
   */
  data class LauncherItem(
    val id: String,
    val type: String,
    val title: String,
    val subtitle: String?,
    val seriesId: String?,
    val seasonId: String?,
    val seasonNumber: Int?,
    val episodeNumber: Int?,
    val imageUrl: String?,
    val durationMs: Long,
    val playbackPositionMs: Long,
    val isResume: Boolean
  )

  /**
   * ===========================================================================
   * Public Bridge: Update Launcher Programs
   * ===========================================================================
   * Receives a JSON-serialized array of programs from JavaScript and updates
   * Android TV Play Next, Preview Channels, and Mobile Shortcuts.
   *
   * @param programsJson Serialized JSON array of item objects
   */
  fun updatePrograms(programsJson: String) {
    executor.execute {
      try {
        // Parse incoming JSON payload into strongly-typed items list
        val items = parseProgramsJson(programsJson)
        if (items.isEmpty()) {
          Log.d(TAG, "Empty programs array received, clearing launcher items")
          clearProgramsInternal()
          return@execute
        }

        Log.i(TAG, "Updating launcher programs with ${items.size} media items")

        // ---------------------------------------------------------------------
        // 1. Android TV & Google TV Home Screen Publishing
        // ---------------------------------------------------------------------
        // Check if host system supports Android TV ContentProvider contracts (API 26+)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          // Sync with the shared system Play Next row
          updateWatchNextPrograms(items)

          // Sync with Litefin's dedicated custom preview channel
          val channelId = getOrCreateChannelId()
          if (channelId != null) {
            // Guarantee channel logo is stored in the TV provider
            writeChannelLogo(channelId)

            // Populate preview program cards for this channel
            updatePreviewPrograms(channelId, items)

            // Request channel visibility on the launcher home screen
            ensureChannelBrowsable(channelId)
          }
        }

        // ---------------------------------------------------------------------
        // 2. Mobile & Tablet Dynamic Launcher Shortcuts
        // ---------------------------------------------------------------------
        // Update long-press app shortcuts on Android 7.1+ (API 25+)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N_MR1) {
          updateDynamicShortcuts(items)
        }
      } catch (e: Exception) {
        Log.e(TAG, "Unexpected error while updating launcher programs", e)
      }
    }
  }

  /**
   * ===========================================================================
   * Public Bridge: Clear Launcher Programs
   * ===========================================================================
   * Clears all published Watch Next, Preview Programs, and Shortcuts upon logout.
   */
  fun clearPrograms() {
    executor.execute {
      clearProgramsInternal()
    }
  }

  /**
   * Internal routine to clear all launcher entries.
   */
  private fun clearProgramsInternal() {
    try {
      // Clear Android TV rows if running on API 26+
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        val contentResolver = context.contentResolver

        // Delete all Litefin entries from the system Play Next table
        try {
          val deletedWatchNext = contentResolver.delete(
            TvContract.WatchNextPrograms.CONTENT_URI,
            null,
            null
          )
          Log.d(TAG, "Cleared $deletedWatchNext WatchNext programs")
        } catch (e: Exception) {
          Log.w(TAG, "Failed clearing WatchNext programs", e)
        }

        // Delete all programs inside Litefin's preview channel
        val channelId = findExistingChannelId()
        if (channelId != null) {
          try {
            val channelProgramsUri = TvContract.buildPreviewProgramsUriForChannel(channelId)
            val deletedPreview = contentResolver.delete(channelProgramsUri, null, null)
            Log.d(TAG, "Cleared $deletedPreview Preview programs from channel $channelId")
          } catch (e: Exception) {
            Log.w(TAG, "Failed clearing Preview programs", e)
          }
        }
      }

      // Remove dynamic launcher shortcuts on phones and tablets
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N_MR1) {
        val shortcutManager = context.getSystemService(ShortcutManager::class.java)
        shortcutManager?.removeAllDynamicShortcuts()
        Log.d(TAG, "Cleared dynamic launcher shortcuts")
      }
    } catch (e: Exception) {
      Log.e(TAG, "Error clearing launcher programs", e)
    }
  }

  /**
   * ===========================================================================
   * Android TV Watch Next (Play Next) Synchronization
   * ===========================================================================
   * Synchronizes items with [TvContract.WatchNextPrograms].
   */
  private fun updateWatchNextPrograms(items: List<LauncherItem>) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return

    val contentResolver = context.contentResolver

    try {
      // -----------------------------------------------------------------------
      // 1. Query Existing Watch Next Programs Owned by Litefin
      // -----------------------------------------------------------------------
      val existingMap = mutableMapOf<String, Long>()
      val cursor = contentResolver.query(
        TvContract.WatchNextPrograms.CONTENT_URI,
        arrayOf(TvContract.WatchNextPrograms._ID, TvContract.WatchNextPrograms.COLUMN_INTERNAL_PROVIDER_ID),
        null,
        null,
        null
      )

      cursor?.use {
        val idIndex = it.getColumnIndex(TvContract.WatchNextPrograms._ID)
        val providerIdIndex = it.getColumnIndex(TvContract.WatchNextPrograms.COLUMN_INTERNAL_PROVIDER_ID)
        while (it.moveToNext()) {
          val programId = it.getLong(idIndex)
          val providerId = if (providerIdIndex >= 0) it.getString(providerIdIndex) else null
          if (!providerId.isNullOrEmpty()) {
            existingMap[providerId] = programId
          }
        }
      }

      // -----------------------------------------------------------------------
      // 2. Remove Stale Entries
      // -----------------------------------------------------------------------
      val currentIds = items.map { it.id }.toSet()
      for ((existingId, rowId) in existingMap) {
        if (!currentIds.contains(existingId)) {
          val programUri = TvContract.buildWatchNextProgramUri(rowId)
          contentResolver.delete(programUri, null, null)
        }
      }

      // -----------------------------------------------------------------------
      // 3. Insert or Update Fresh Entries
      // -----------------------------------------------------------------------
      val now = System.currentTimeMillis()
      for ((index, item) in items.withIndex()) {
        val intent = createItemIntent(item)
        val intentUri = intent.toUri(Intent.URI_INTENT_SCHEME)

        val values = ContentValues().apply {
          put(TvContract.WatchNextPrograms.COLUMN_INTERNAL_PROVIDER_ID, item.id)
          put(TvContract.WatchNextPrograms.COLUMN_TITLE, item.title)

          // Supply synopsis/description to both short description and episode title columns
          // guaranteeing launcher skins display the episode overview
          if (!item.subtitle.isNullOrEmpty()) {
            put(TvContract.WatchNextPrograms.COLUMN_SHORT_DESCRIPTION, item.subtitle)
            put(TvContract.WatchNextPrograms.COLUMN_EPISODE_TITLE, item.subtitle)
          }

          // Season and Episode numbering
          if (item.seasonNumber != null) {
            put(TvContract.WatchNextPrograms.COLUMN_SEASON_DISPLAY_NUMBER, item.seasonNumber.toString())
          }
          if (item.episodeNumber != null) {
            put(TvContract.WatchNextPrograms.COLUMN_EPISODE_DISPLAY_NUMBER, item.episodeNumber.toString())
          }

          // Visual artwork thumbnail with explicit 16:9 aspect ratio
          if (!item.imageUrl.isNullOrEmpty()) {
            put(TvContract.WatchNextPrograms.COLUMN_POSTER_ART_URI, item.imageUrl)
            put(TvContract.WatchNextPrograms.COLUMN_POSTER_ART_ASPECT_RATIO, TvContract.WatchNextPrograms.ASPECT_RATIO_16_9)
          }

          // Launch action
          put(TvContract.WatchNextPrograms.COLUMN_INTENT_URI, intentUri)

          // Media program type
          put(
            TvContract.WatchNextPrograms.COLUMN_TYPE,
            if (item.type.equals("episode", ignoreCase = true)) {
              TvContract.PreviewPrograms.TYPE_TV_EPISODE
            } else {
              TvContract.PreviewPrograms.TYPE_MOVIE
            }
          )

          // Distinguish between resume (in-progress) and next up (unwatched next episode)
          put(
            TvContract.WatchNextPrograms.COLUMN_WATCH_NEXT_TYPE,
            if (item.isResume) {
              TvContract.WatchNextPrograms.WATCH_NEXT_TYPE_CONTINUE
            } else {
              TvContract.WatchNextPrograms.WATCH_NEXT_TYPE_NEXT
            }
          )

          // Stagger engagement timestamps so first items sort to front of row
          put(TvContract.WatchNextPrograms.COLUMN_LAST_ENGAGEMENT_TIME_UTC_MILLIS, now - (index * 1000L))

          // Playback progress indicator
          if (item.durationMs > 0) {
            put(TvContract.WatchNextPrograms.COLUMN_DURATION_MILLIS, item.durationMs)
          }
          if (item.playbackPositionMs > 0) {
            put(TvContract.WatchNextPrograms.COLUMN_LAST_PLAYBACK_POSITION_MILLIS, item.playbackPositionMs)
          }
        }

        val existingRowId = existingMap[item.id]
        if (existingRowId != null) {
          val programUri = TvContract.buildWatchNextProgramUri(existingRowId)
          contentResolver.update(programUri, values, null, null)
        } else {
          contentResolver.insert(TvContract.WatchNextPrograms.CONTENT_URI, values)
        }
      }
    } catch (e: Exception) {
      Log.w(TAG, "Failed syncing WatchNext programs", e)
    }
  }

  /**
   * ===========================================================================
   * Android TV Dedicated Preview Channel Management
   * ===========================================================================
   * Queries or creates Litefin's dedicated channel row in [TvContract.Channels].
   */
  private fun getOrCreateChannelId(): Long? {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return null

    // Locate existing channel if already registered in provider database
    val existingId = findExistingChannelId()
    if (existingId != null) {
      Log.d(TAG, "Found existing Litefin preview channel ID: $existingId")
      return existingId
    }

    val contentResolver = context.contentResolver
    return try {
      // Construct launch intent that activates main Litefin interface
      val appLinkIntent = Intent(Intent.ACTION_MAIN).apply {
        setClass(context, MainActivity::class.java)
        flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
      }

      // Do NOT set COLUMN_PACKAGE_NAME; TvProvider automatically assigns it from caller package.
      // Explicitly setting it will throw IllegalArgumentException on many Android TV builds.
      val values = ContentValues().apply {
        put(TvContract.Channels.COLUMN_TYPE, TvContract.Channels.TYPE_PREVIEW)
        put(TvContract.Channels.COLUMN_DISPLAY_NAME, CHANNEL_DISPLAY_NAME)
        put(TvContract.Channels.COLUMN_DESCRIPTION, "Continue Watching and Next Up in Litefin")
        put(TvContract.Channels.COLUMN_APP_LINK_INTENT_URI, appLinkIntent.toUri(Intent.URI_INTENT_SCHEME))
        put(TvContract.Channels.COLUMN_INTERNAL_PROVIDER_ID, CHANNEL_INTERNAL_ID)
      }

      val channelUri = contentResolver.insert(TvContract.Channels.CONTENT_URI, values)
      if (channelUri != null) {
        val channelId = ContentUris.parseId(channelUri)
        Log.i(TAG, "Created dedicated Litefin preview channel with ID: $channelId")
        channelId
      } else {
        Log.w(TAG, "Channels.CONTENT_URI insert returned null")
        null
      }
    } catch (e: Exception) {
      Log.e(TAG, "Failed creating preview channel", e)
      null
    }
  }

  /**
   * Locates an already-registered preview channel ID for Litefin.
   * Cleans up duplicate channel entries if found from prior initialization cycles.
   */
  private fun findExistingChannelId(): Long? {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return null

    val contentResolver = context.contentResolver
    return try {
      val cursor = contentResolver.query(
        TvContract.Channels.CONTENT_URI,
        arrayOf(TvContract.Channels._ID, TvContract.Channels.COLUMN_INTERNAL_PROVIDER_ID),
        null,
        null,
        null
      )
      cursor?.use {
        val idIdx = it.getColumnIndex(TvContract.Channels._ID)
        val providerIdIdx = it.getColumnIndex(TvContract.Channels.COLUMN_INTERNAL_PROVIDER_ID)
        var primaryId: Long? = null
        while (it.moveToNext()) {
          val providerId = if (providerIdIdx >= 0) it.getString(providerIdIdx) else null
          if (providerId == CHANNEL_INTERNAL_ID && idIdx >= 0) {
            val rowId = it.getLong(idIdx)
            if (primaryId == null) {
              primaryId = rowId
            } else {
              // Remove redundant duplicate channel entries created in previous cycles
              try {
                contentResolver.delete(TvContract.buildChannelUri(rowId), null, null)
              } catch (_: Exception) {}
            }
          }
        }
        primaryId
      }
    } catch (e: Exception) {
      Log.d(TAG, "Channel query returned exception", e)
      null
    }
  }

  /**
   * ===========================================================================
   * Android TV Channel Branding & Logo Storage
   * ===========================================================================
   * Leanback launchers require every preview channel to supply a channel logo.
   * Stores the application icon as a PNG bitmap into the channel's logo URI.
   */
  private fun writeChannelLogo(channelId: Long) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return

    try {
      // Retrieve the application launcher icon
      val drawable = context.packageManager.getApplicationIcon(context.packageName)

      // Convert icon drawable into a 32-bit ARGB Bitmap
      val width = if (drawable.intrinsicWidth > 0) drawable.intrinsicWidth else 160
      val height = if (drawable.intrinsicHeight > 0) drawable.intrinsicHeight else 160
      val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
      val canvas = Canvas(bitmap)
      drawable.setBounds(0, 0, canvas.width, canvas.height)
      drawable.draw(canvas)

      // Write PNG stream to the system TV Provider logo content URI
      val logoUri = TvContract.buildChannelLogoUri(channelId)
      context.contentResolver.openOutputStream(logoUri)?.use { stream ->
        bitmap.compress(Bitmap.CompressFormat.PNG, 100, stream)
        stream.flush()
      }
      Log.d(TAG, "Successfully stored channel logo for channel $channelId")
    } catch (e: Exception) {
      Log.w(TAG, "Failed storing channel logo for channel $channelId", e)
    }
  }

  /**
   * Evaluates whether the preview channel is currently browsable (visible) on the TV launcher.
   */
  private fun isChannelBrowsable(channelId: Long): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return false

    val contentResolver = context.contentResolver
    return try {
      val cursor = contentResolver.query(
        TvContract.buildChannelUri(channelId),
        arrayOf(TvContract.Channels.COLUMN_BROWSABLE),
        null,
        null,
        null
      )
      cursor?.use {
        if (it.moveToFirst()) {
          val idx = it.getColumnIndex(TvContract.Channels.COLUMN_BROWSABLE)
          if (idx >= 0) it.getInt(idx) == 1 else false
        } else {
          false
        }
      } ?: false
    } catch (e: Exception) {
      Log.d(TAG, "Failed reading channel browsable state", e)
      false
    }
  }

  /**
   * Requests Android TV system to display this preview channel on the user's home screen.
   * Called only after programs and logo have been populated.
   */
  private fun ensureChannelBrowsable(channelId: Long) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return

    try {
      if (!isChannelBrowsable(channelId)) {
        Log.i(TAG, "Channel $channelId is not yet browsable; requesting browsable status on home screen")
        TvContract.requestChannelBrowsable(context, channelId)
      } else {
        Log.d(TAG, "Channel $channelId is already browsable on TV home screen")
      }
    } catch (e: Exception) {
      Log.w(TAG, "requestChannelBrowsable threw on this TV model", e)
    }
  }

  /**
   * Updates preview cards within Litefin's dedicated preview channel.
   */
  private fun updatePreviewPrograms(channelId: Long, items: List<LauncherItem>) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return

    val contentResolver = context.contentResolver

    try {
      // Clear existing preview cards in this channel using official channel programs URI
      val channelProgramsUri = TvContract.buildPreviewProgramsUriForChannel(channelId)
      contentResolver.delete(channelProgramsUri, null, null)

      // Insert fresh batch of preview cards
      for ((index, item) in items.withIndex()) {
        val intent = createItemIntent(item)
        val intentUri = intent.toUri(Intent.URI_INTENT_SCHEME)

        val values = ContentValues().apply {
          put(TvContract.PreviewPrograms.COLUMN_CHANNEL_ID, channelId)
          put(TvContract.PreviewPrograms.COLUMN_INTERNAL_PROVIDER_ID, item.id)
          put(TvContract.PreviewPrograms.COLUMN_TITLE, item.title)

          // Supply synopsis/description to both short description and episode title columns
          if (!item.subtitle.isNullOrEmpty()) {
            put(TvContract.PreviewPrograms.COLUMN_SHORT_DESCRIPTION, item.subtitle)
            put(TvContract.PreviewPrograms.COLUMN_EPISODE_TITLE, item.subtitle)
          }
          if (item.seasonNumber != null) {
            put(TvContract.PreviewPrograms.COLUMN_SEASON_DISPLAY_NUMBER, item.seasonNumber.toString())
          }
          if (item.episodeNumber != null) {
            put(TvContract.PreviewPrograms.COLUMN_EPISODE_DISPLAY_NUMBER, item.episodeNumber.toString())
          }
          if (!item.imageUrl.isNullOrEmpty()) {
            put(TvContract.PreviewPrograms.COLUMN_POSTER_ART_URI, item.imageUrl)
            put(TvContract.PreviewPrograms.COLUMN_POSTER_ART_ASPECT_RATIO, TvContract.PreviewPrograms.ASPECT_RATIO_16_9)
          }

          put(TvContract.PreviewPrograms.COLUMN_INTENT_URI, intentUri)
          put(
            TvContract.PreviewPrograms.COLUMN_TYPE,
            if (item.type.equals("episode", ignoreCase = true)) {
              TvContract.PreviewPrograms.TYPE_TV_EPISODE
            } else {
              TvContract.PreviewPrograms.TYPE_MOVIE
            }
          )
          // Weight drives order in channel row
          put(TvContract.PreviewPrograms.COLUMN_WEIGHT, 100 - index)

          if (item.durationMs > 0) {
            put(TvContract.PreviewPrograms.COLUMN_DURATION_MILLIS, item.durationMs)
          }
          if (item.playbackPositionMs > 0) {
            put(TvContract.PreviewPrograms.COLUMN_LAST_PLAYBACK_POSITION_MILLIS, item.playbackPositionMs)
          }
        }

        contentResolver.insert(TvContract.PreviewPrograms.CONTENT_URI, values)
      }
      Log.d(TAG, "Updated preview channel $channelId with ${items.size} programs")
    } catch (e: Exception) {
      Log.w(TAG, "Failed updating preview cards in channel $channelId", e)
    }
  }

  /**
   * ===========================================================================
   * Mobile & Tablet Dynamic Launcher Shortcuts
   * ===========================================================================
   * Generates dynamic app shortcuts for Android phones and tablets.
   */
  private fun updateDynamicShortcuts(items: List<LauncherItem>) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N_MR1) return

    try {
      val shortcutManager = context.getSystemService(ShortcutManager::class.java) ?: return
      val shortcuts = mutableListOf<ShortcutInfo>()

      // Android restricts dynamic shortcuts to max 4-5 items
      for ((index, item) in items.take(4).withIndex()) {
        val intent = createItemIntent(item)
        val fullTitle = item.title
        val shortLabel = if (fullTitle.length > 25) fullTitle.take(22) + "..." else fullTitle

        val shortcut = ShortcutInfo.Builder(context, "litefin_${item.id}")
          .setShortLabel(shortLabel)
          .setLongLabel(fullTitle)
          .setIntent(intent)
          .setRank(index)
          .build()

        shortcuts.add(shortcut)
      }

      shortcutManager.dynamicShortcuts = shortcuts
      Log.d(TAG, "Published ${shortcuts.size} dynamic shortcuts")
    } catch (e: Exception) {
      Log.w(TAG, "Failed publishing dynamic launcher shortcuts", e)
    }
  }

  /**
   * ===========================================================================
   * Deep Link Intent Construction
   * ===========================================================================
   * Constructs the explicit [Intent] targeting [MainActivity] for a media item.
   */
  fun createItemIntent(item: LauncherItem): Intent {
    return Intent(Intent.ACTION_VIEW, Uri.parse("litefin://item/${item.id}")).apply {
      setClass(context, MainActivity::class.java)
      setPackage(context.packageName)
      putExtra("id", item.id)
      putExtra("type", item.type)
      if (!item.seriesId.isNullOrEmpty()) putExtra("seriesid", item.seriesId)
      if (!item.seasonId.isNullOrEmpty()) putExtra("seasonid", item.seasonId)
      flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
    }
  }

  /**
   * ===========================================================================
   * Deep Link Intent Extraction & Dispatch
   * ===========================================================================
   * Parses deep-link payloads from incoming intents and dispatches them to web runtime.
   */
  fun handleIncomingIntent(intent: Intent?): String? {
    val payload = extractDeepLinkPayload(intent) ?: return null
    Log.i(TAG, "Processing incoming deep link intent: $payload")
    dispatchDeepLinkToWeb(payload)
    return payload
  }

  /**
   * Extracts deep-link item coordinates from either intent extras or Uri data.
   */
  fun extractDeepLinkPayload(intent: Intent?): String? {
    if (intent == null) return null
    try {
      // 1. Check intent extras
      val idFromExtra = intent.getStringExtra("id")
      if (!idFromExtra.isNullOrEmpty()) {
        val json = JSONObject()
        json.put("id", idFromExtra)
        json.put("type", intent.getStringExtra("type") ?: "")
        intent.getStringExtra("seriesid")?.let { json.put("seriesid", it) }
        intent.getStringExtra("seasonid")?.let { json.put("seasonid", it) }
        return json.toString()
      }

      // 2. Check intent data URI (e.g., litefin://item/{id}?type=movie)
      val uri = intent.data
      if (uri != null && uri.scheme == "litefin" && uri.host == "item") {
        val path = uri.path?.removePrefix("/") ?: uri.lastPathSegment
        val id = if (!path.isNullOrEmpty()) path else uri.getQueryParameter("id")
        if (!id.isNullOrEmpty()) {
          val json = JSONObject()
          json.put("id", id)
          json.put("type", uri.getQueryParameter("type") ?: "")
          uri.getQueryParameter("seriesid")?.let { json.put("seriesid", it) }
          uri.getQueryParameter("seasonid")?.let { json.put("seasonid", it) }
          return json.toString()
        }
      }
    } catch (e: Exception) {
      Log.w(TAG, "Failed extracting deep link payload", e)
    }
    return null
  }

  /**
   * Dispatches the deep-link JSON payload into the active Chromium WebView.
   */
  fun dispatchDeepLinkToWeb(payload: String) {
    activity.runOnUiThread {
      try {
        val escaped = JSONObject.quote(payload)
        activity.activeWebView?.evaluateJavascript(
          """
          (function() {
            var data = JSON.parse($escaped);
            if (window.androidLauncherManager && typeof window.androidLauncherManager.handleDeepLink === 'function') {
              window.androidLauncherManager.handleDeepLink(data);
            } else if (window.androidAdapter && typeof window.androidAdapter.handleDeepLink === 'function') {
              window.androidAdapter.handleDeepLink(data);
            } else {
              window.__pendingAndroidDeepLink = data;
            }
          })();
          """.trimIndent(),
          null
        )
      } catch (e: Exception) {
        Log.e(TAG, "Failed dispatching deep link to WebView", e)
      }
    }
  }

  /**
   * Parses JSON array received from JavaScript bridge into strongly-typed items.
   */
  private fun parseProgramsJson(jsonString: String): List<LauncherItem> {
    val result = mutableListOf<LauncherItem>()
    try {
      val array = JSONArray(jsonString)
      for (i in 0 until array.length()) {
        val obj = array.getJSONObject(i)
        val id = obj.optString("id", "")
        if (id.isEmpty()) continue

        result.add(
          LauncherItem(
            id = id,
            type = obj.optString("type", "movie"),
            title = obj.optString("title", "Unknown"),
            subtitle = obj.optString("subtitle").takeIf { it.isNotEmpty() }
              ?: obj.optString("description").takeIf { it.isNotEmpty() },
            seriesId = obj.optString("seriesId").takeIf { it.isNotEmpty() },
            seasonId = obj.optString("seasonId").takeIf { it.isNotEmpty() },
            seasonNumber = if (obj.has("seasonNumber") && !obj.isNull("seasonNumber")) obj.getInt("seasonNumber") else null,
            episodeNumber = if (obj.has("episodeNumber") && !obj.isNull("episodeNumber")) obj.getInt("episodeNumber") else null,
            imageUrl = obj.optString("imageUrl").takeIf { it.isNotEmpty() },
            durationMs = obj.optLong("durationMs", 0L),
            playbackPositionMs = obj.optLong("playbackPositionMs", 0L),
            isResume = obj.optBoolean("isResume", false)
          )
        )
      }
    } catch (e: Exception) {
      Log.e(TAG, "Failed parsing programs JSON", e)
    }
    return result
  }
}
