# METRO CITY ROLE PLAY - Design System

## Color Palette

### Primary Colors
| Color | Hex | Usage |
|-------|-----|-------|
| Teal | `#00d4ff` | Main accent, buttons, highlights |
| Dark Teal | `#0099cc` | Hover states, gradients |
| Pink | `#ff6b9d` | Secondary accent, gradients |
| Gold | `#ffd700` | Special highlights |
| Purple | `#9d4edd` | Tertiary accent, staff section |

### Background Colors
| Color | Hex | Usage |
|-------|-----|-------|
| Dark | `#0a0a1a` | Main background |
| Darker | `#050510` | Footer, overlays |

### Text Colors
| Color | Hex | Usage |
|-------|-----|-------|
| Light | `#ffffff` | Main text |
| Muted | `#b0b0b0` | Secondary text |

## Typography

### Primary Font (GTA Style)
- **Font:** Bungee Shade
- **Usage:** Headings, titles, hero text
- **Fallback:** Russo One, Orbitron

### Secondary Font
- **Font:** Orbitron
- **Usage:** Body text, buttons, navigation
- **Weights:** 400, 700, 900

## Gradients

### Sunset Gradient
```css
linear-gradient(135deg, #00d4ff 0%, #9d4edd 50%, #ff6b9d 100%)
```

### Neon Gradient
```css
linear-gradient(90deg, #00d4ff, #00ff88, #00d4ff)
```

## Shadows

### Neon Shadow
```css
box-shadow: 0 0 20px rgba(0, 212, 255, 0.5);
```

### Pink Shadow
```css
box-shadow: 0 0 20px rgba(255, 107, 157, 0.5);
```

## Design Elements

### Border Radius
- Small: `4px`
- Medium: `8px`
- Large: `12px`

### Spacing
- Section padding: `100px 5%`
- Card padding: `2rem`
- Element gap: `1rem - 2rem`

## Animations

### Glow Animation
```css
@keyframes glow {
    from { filter: drop-shadow(0 0 20px rgba(0, 212, 255, 0.5)); }
    to { filter: drop-shadow(0 0 40px rgba(0, 212, 255, 0.8)); }
}
```

### Float Animation
```css
@keyframes float {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-10px); }
}
```

### Pulse Animation
```css
@keyframes pulse {
    0%, 100% { opacity: 1; box-shadow: 0 0 10px #00ff88; }
    50% { opacity: 0.5; box-shadow: 0 0 20px #00ff88; }
}
```

## Responsive Breakpoints

- Desktop: `1024px+`
- Tablet: `768px - 1024px`
- Mobile: `480px - 768px`
- Small Mobile: `< 480px`

## Theme Inspiration

GTA Vice City / Miami Vice aesthetic:
- Neon colors
- Sunset gradients
- 80s retro vibe
- Palm trees and city lights
- Cyan, pink, and purple tones