# UI & UX

Litefin is crafted to deliver a unified, premium visual aesthetic and responsive fluidity across diverse form factors — seamlessly transitioning between the 10-foot TV experience, desktop environments, and mobile touchscreens.

## Design System

The application uses a custom-built design system that avoids generic browser defaults in favor of sleek, modern aesthetics:

- **Theming System**: CSS variable-based styling (`src/themes/`) with 5 theme modes:
  - **Classic Dark**: Balanced contrast for home theater viewing.
  - **Classic Light**: Clean light presentation.
  - **True Black**: Pure OLED `#000000` blacks for zero backlight bleed.
  - **Tinted Light & Tinted Dark**: Rich monochromatic depth tailored to your accent.
  - **Ambient Glow**: Dynamic ambient accents reflecting backdrop artwork.
- **Dynamic Accent Colors**: User-selected accent colors with automatic gradient and variant computation.
- **Glassmorphism & Depth**: Multi-layer frosted overlays for dialogs, sidebars, and OSD controls.
- **Rounded Aesthetics**: Configurable corner rounding across cards, buttons, and badges.
- **Layout Manager** (`src/ui/LayoutManager.js`): Centralized engine managing responsive breakpoints, font overrides, text scaling, card label presentations (titleOnly, two lines, hidden), low VRAM mode, and BlurHash decoding.

## Adaptive Interaction Paradigms

### 1. 10-Foot TV Experience (Remote & D-Pad)
- **FocusManager & SpatialNavigator**: Geometric 2D spatial navigation for media grids and carousels with a 40ms input debounce.
- **Remote Button Mapping**: Dedicated handling for Red, Green, Yellow, and Blue shortcut keys via `RemoteButtonManager.js`.
- **Magic Remote Compatibility**: LG air-mouse pointer click binding, wheel-based list scrolling, and slider adjustments.

### 2. Desktop Environment (Keyboard & Mouse)
- **Cursor & Hover Interactions**: Smooth card zoom, active states, and focus-on-hover behavior.
- **Keyboard Navigation**: Standard arrow key navigation, media controls (Space for play/pause, M for mute, F for fullscreen, Esc for back).
- **Window Management**: Custom frameless titlebar controls, draggable header areas, and native window resize listeners via Tauri v2.

### 3. Mobile & Tablet (Touch)
- **Touch-First Controls**: Direct touch scrolling through horizontal card rows (`VirtualCardRow`) and vertical grids with momentum scrolling.
- **Responsive Layout Adaptation**: Auto-collapsing sidebars, touch-friendly hit targets, and orientation handling.

## Virtualization & Fluidity

- **VirtualCardRow & VirtualGrid**: Horizontal DOM recycling with sliding windows to render thousands of media items without memory bloat or frame drops.
- **GPU-Accelerated Transitions**: All layout animations are CSS transform/opacity-driven to prevent layout thrashing on low-end TV and mobile chipsets.
- **Navigation State & Focus Restoration**: `NavigationState.js` captures and restores scroll offsets, active card indexes, and focus targets (`[data-item-id]`) across backward/forward navigation.

