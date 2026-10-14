# Architecture

Litefin is structured as a modular Web Application. The architecture is designed to handle complex navigation, focus states, and media playback asynchronously on resource-constrained TV hardware.

## Core Framework

- **EventBus** (`src/core/EventBus.js`): A centralized pub/sub messaging system for app-wide communication, allowing decoupled modules to react to state changes (e.g., authentication, playback updates). Supports `on`, `once`, `off`, `emit`, `clear`, and `listenerCount`. Returns unsubscribe functions from `on()`/`once()`.
- **StateManager** (`src/core/StateManager.js`): Manages persistent and session-based application state, including server connections, user preferences, and reactive subscriptions. Changes emit `state:{key}` events on the EventBus for decoupled observation.
- **Router** (`src/core/Router.js`): A hash-based SPA router supporting client-side navigation, history stacks (max 20 entries), param matching (`:param` syntax), and robust state restoration via `NavigationState` when navigating between pages.
- **NavigationState** (`src/core/NavigationState.js`): Captures and restores scroll position, focus element, and page-specific state (filters, sort, pagination) during navigation. Uses a three-tier focus restoration strategy: `onRestoreIndex` hook → CSS selector (`[data-item-id]`) → section + index fallback.

## UI Engine

- **Component** (`src/core/Component.js`): Base class for all UI elements. Lifecycle: `constructor` → `render()` (returns HTML string) → `mount()` → `onMounted()` → `update()`/`setState()` → `destroy()`. Supports auto-cleaning subscriptions via `this.on()` and child tracking via `this.addChild()`.
- **Page** (`src/pages/Page.js`): Extends `Component` with route params, focus section registration, navigation state save/restore, loading/error states, and `markReady()` for async initialization.
- **FocusManager** (`src/ui/FocusManager.js`): Critical component for TV environments. Handles D-Pad navigation, section-based memory, spatial navigation, focus trapping for modals, and Magic Remote wheel support. Debounce set to 40ms for TV remote input. Uses `SpatialNavigator` and `ScrollController`.
- **VirtualCardRow** (`src/components/VirtualCardRow.js`): High-performance horizontal card row with DOM recycling (sliding window). Essential for smooth scrolling through large media libraries with limited memory.

## Platforms & Runtime Environments

Litefin dynamically detects the execution environment via `PlatformInfo` (`src/utils/PlatformInfo.js`) and configures hardware interfaces, input handlers, and player pipelines accordingly:

- **Samsung Tizen**:
  - Direct hardware video rendering via `TizenAVPlayer.js` (`webapis.avplay`).
  - Remote key handling and lifecycle management via `TizenAdapter.js`.
  - Tizen SmartHub preview integration via `SmartHubManager.js`.
  - Background HTTP server discovery service (`services/service.js`).
- **LG webOS**:
  - Hardware playback via `WebOSPlayer.js` and webOS media pipelines.
  - Platform integration via `WebOSAdapter.js`.
  - Instant server discovery via Luna Service calls.
  - Dedicated XHR loader for local `file://` assets (bypassing webOS fetch restrictions).
- **Android (Android TV, Google TV, Fire TV & Mobile)**:
  - Native video playback via `ExoVideoPlayer.js` backed by **Media3 ExoPlayer** through the **Tauri v2** Android bridge.
  - Multichannel audio passthrough (TrueHD, DTS-HD MA, Dolby Atmos) and dynamic codec capability detection via `MediaCodecList`.
  - Interception of TV D-Pad, media keys, and hardware Back button with graceful exit/back navigation.
- **Desktop (Windows, Linux, macOS)**:
  - High-performance WASM & WebCodecs playback via `MoviVideoPlayer.js` (`movi-player`) with seamless auto-failover to `HtmlVideoPlayer.js`.
  - Native application window management, tray integration, and custom titlebar styling via **Tauri v2**.
  - Full keyboard shortcuts, mouse hover/scroll interactions, and window resizing support.
- **Web & Server Plugin (Jellyfin Web)**:
  - Runs inside standard desktop and mobile browsers via `HtmlVideoPlayer.js`.
  - Can be hosted directly on the Jellyfin server via `Litefin.Client.Plugin` to serve Litefin at `/litefin`.

## Multi-Engine Playback Pipeline

The playback subsystem (`src/player/core/`) coordinates media decoding through `JellyfinPlayer.js`, dynamically routing streams to the best available engine:
- `TizenAVPlayer.js`: Samsung hardware decoding with byte-level buffer tuning and zero-latency seek queues.
- `WebOSPlayer.js`: LG hardware pipeline with platform lifecycle state synchronizers.
- `ExoVideoPlayer.js`: Android Media3 ExoPlayer with multichannel bitstreaming and AV1 fallback.
- `MoviVideoPlayer.js`: Desktop WASM and WebCodecs engine.
- `HtmlVideoPlayer.js`: Universal HTML5 `<video>` engine for browser environments and fallback.

### Subtitle Rendering Engine
- `@jellyfin/libass-wasm` (`LibassWasmRenderer.js`): High-fidelity ASS/SSA styling compiled to WebAssembly.
- `libpgs` (`PGSRenderer.js`): Native image-based PGS subtitle decoding and scaling.
- `assjs` (`ASSJSRenderer.js` / `ASSRenderer.js`): Pure-JavaScript fallback for engines lacking WebAssembly support.
- `SubtitleParser.js`: Pure JavaScript text subtitle parser with customizable style overrides.

## Input & Navigation Architecture

Litefin unifies interaction models across 10-foot, desktop, and touch form factors:
- **FocusManager** (`src/ui/FocusManager.js`): Centralized focus controller with section memory, spatial navigation (`SpatialNavigator.js`), trap stacks for dialogs, and 40ms debounce for TV remote D-Pads.
- **RemoteButtonManager** (`src/core/RemoteButtonManager.js`): Manages Samsung / webOS / Android colored buttons (Red, Green, Yellow, Blue).
- **Pointer & Touch Support**: LG Magic Remote air-mouse pointer, desktop mouse navigation, and mobile touch gestures with smooth scrolling via `ScrollController.js`.
- **NavigationState** (`src/core/NavigationState.js`): Deep focus restoration preserving scroll positions, active rows, and item IDs across navigation stacks.

## Plugin System

Litefin supports modular extensions via `PluginManager` (`src/plugins/PluginManager.js`). Plugins are sandboxed through `PluginAPI` and can listen to playback/page lifecycle events, add OSD widgets, and communicate with server-side Jellyfin plugins via `ServerPluginClient`.

**Bundled plugins:**
- **Intro Skipper** (`skip-intro`): Automatic skip buttons for intros and recaps via server metadata.
- **SyncPlay** (`syncplay`): Real-time synchronized playback via server WebSockets.
- **Local Intros** (`local-intros`): Custom pre-roll cinema bumper video playback.
- **MDBList Ratings** (`mdblist-ratings`): Multi-source ratings (IMDb, Rotten Tomatoes, Metacritic, Trakt, TMDB, Letterboxd) on media cards.

[**Plugin development guide**](./Plugins.md)

## Localization

The **i18n** module (`src/utils/i18n.js`) handles multi-language support via flat JSON locale files with interpolation placeholders (`{0}`, `{1}`, …) and full Right-to-Left (RTL) layout support.

[**Localization guide**](./Localization.md)

## Screensaver & Background Services

- **ScreensaverManager** (`src/core/ScreensaverManager.js`): Dims the screen and hides titles after inactivity, ported from Jellyfin Web with TV-specific optimizations.
- **Background Server Discovery**: Multi-tier discovery (webOS Luna, Tizen HTTP service, local subnet scanning, Quick Connect QR code, and Wake-on-LAN).

