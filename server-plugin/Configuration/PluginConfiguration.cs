namespace Litefin.Web.Configuration;

using MediaBrowser.Model.Plugins;

/// <summary>
/// ============================================================================
/// Litefin Client - Plugin Configuration Model
/// ============================================================================
/// Stores server-wide settings for the Litefin Client hosting plugin.
/// Jellyfin automatically serializes and persists instances of this configuration
/// to the server's plugins configuration directory.
/// ============================================================================
/// </summary>
public class PluginConfiguration : BasePluginConfiguration
{
    /// <summary>
    /// Initializes a new instance of the <see cref="PluginConfiguration"/> class.
    /// Sets sensible defaults for client isolation and web hosting.
    /// </summary>
    public PluginConfiguration()
    {
        // Enable cross-origin isolation by default so the Movi WebAssembly player
        // and WebCodecs can use SharedArrayBuffer for high-performance demuxing.
        EnableCrossOriginIsolation = true;

        // Custom branding label shown in the Jellyfin navigation menu sidebar
        PluginMenuTitle = Plugin.Instance?.Name ?? "Litefin Client";
    }

    /// <summary>
    /// Gets or sets a value indicating whether Cross-Origin-Opener-Policy (COOP) and
    /// Cross-Origin-Embedder-Policy (COEP) response headers should be attached when serving index.html.
    /// Required for WebAssembly multi-threading in modern browsers.
    /// </summary>
    public bool EnableCrossOriginIsolation { get; set; }

    /// <summary>
    /// Gets or sets the custom menu title displayed in the Jellyfin web navigation sidebar.
    /// </summary>
    public string PluginMenuTitle { get; set; }
}
