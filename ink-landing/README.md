# INK — Real-Time WebGL2 Fluid Rendering Engine

A high-performance, dark-themed landing page and isolated React component for a real-time GPU fluid simulation engine based on the Navier–Stokes equations (incompressible flow, advection, vorticity confinement, and Jacobi pressure solve).

---

## Tech Stack
- **Framework**: Vite + React 19 + TypeScript
- **Styling**: Tailwind CSS v4
- **Animation**: Framer Motion
- **Graphics**: Raw WebGL2 (No Three.js required)

---

## WebGL2 Fluid Simulation Architecture

The fluid simulation is implemented as a classical Stam / Pavel DoGreat Navier–Stokes GPU solver running across offscreen ping-pong framebuffers:

1. **Splat**: Injects velocity and color impulses into the velocity and density textures on pointer movement and periodic idle timers.
2. **Curl**: Calculates the vorticity $\omega = \frac{\partial v}{\partial x} - \frac{\partial u}{\partial y}$ of the velocity field.
3. **Vorticity Confinement**: Adds small rotational forces back to the velocity field to counteract numerical dissipation and keep micro-turbulences energetic.
4. **Divergence**: Computes $\nabla \cdot \mathbf{u}$ over the velocity grid.
5. **Pressure Solve**: Solves the Poisson pressure equation $\nabla^2 p = \nabla \cdot \mathbf{u}$ using 20–30 Jacobi relaxation iterations.
6. **Gradient Subtraction**: Projects the velocity field onto a divergence-free space ($\nabla \cdot \mathbf{u} = 0$).
7. **Advection**: Solves the transport equation $\frac{\partial q}{\partial t} + (\mathbf{u} \cdot \nabla)q = 0$ for both velocity and color density with decay dissipation.
8. **Display**: Composites the dye texture to the canvas with tone mapping, soft bloom, and near-black (`#05050a`) background blending.

---

## Tunable Simulation Parameters

All parameters can be tuned in `src/components/fluid/constants.ts` or passed as props into `<FluidCanvas config={{ ... }} />`:

| Parameter | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `SIM_RESOLUTION` | `number` | `128` | Grid resolution for velocity, divergence, curl, and pressure FBOs (use `64` for low-end/mobile). |
| `DYE_RESOLUTION` | `number` | `1024` | Resolution of the visual color dye texture (use `512` for mobile). |
| `DENSITY_DISSIPATION` | `number` | `0.98` | Rate at which dye color fades over time (higher = lingers longer). |
| `VELOCITY_DISSIPATION`| `number` | `0.985`| Rate at which fluid momentum slows down. |
| `PRESSURE` | `number` | `0.8` | Jacobi pressure relaxation factor. |
| `PRESSURE_ITERATIONS`| `number` | `24` | Number of Jacobi solver iterations per frame (16–32). |
| `CURL` | `number` | `32.0` | Vorticity confinement scale; creates detailed swirls and eddies. |
| `SPLAT_RADIUS` | `number` | `0.28` | Radius of the pointer and idle splat injection. |
| `SPLAT_FORCE` | `number` | `6000.0`| Momentum impulse injected per unit of pointer movement. |
| `COLOR_PALETTE` | `Array<{r,g,b}>` | 5 colors | Brand colors (Deep Indigo, Electric Violet, Luminous Cyan, Hot Pink, Electric Blue). |
| `AUTO_SPLAT_INTERVAL`| `number` | `2600` | Milliseconds between random idle splats so the canvas stays alive without interaction. |
| `BLOOM` | `boolean` | `true` | Enables post-processing glow pass. |
| `BLOOM_INTENSITY` | `number` | `0.45` | Intensity of the soft bloom effect. |

---

## Usage in React

```tsx
import { FluidCanvas } from "./components/fluid/FluidCanvas";

export default function App() {
  return (
    <div className="relative min-h-screen bg-[#05050a]">
      {/* Background Fluid Canvas */}
      <FluidCanvas
        config={{
          DENSITY_DISSIPATION: 0.98,
          CURL: 35.0,
          SPLAT_RADIUS: 0.3,
        }}
      />

      {/* Foreground UI */}
      <div className="relative z-10">
        <h1>Your content goes here</h1>
      </div>
    </div>
  );
}
```

---

## Running Locally

```bash
# Install dependencies
npm install

# Start Vite development server
npm run dev

# Production build
npm run build
```
