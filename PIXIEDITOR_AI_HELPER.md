# PixiEditor Source Reference for AI

> Pre-analyzed map of `TEMP_TO_BE_REMOVED/PixiEditor-master/src/`.
> Read this before studying PixiEditor source for any new feature.

---

## Stack

- **Language**: C# / .NET
- **UI Framework**: Avalonia (cross-platform WPF-like)
- **2D Rendering**: Skia via `Drawie` wrapper (`DrawingContext`, `Canvas`, `Paint`, `Path`)
- **Architecture**: MVVM — Views + ViewModels + ChangeableDocument (document model)

---

## Key Projects

| Project | Purpose |
|---|---|
| `PixiEditor/` | Main app — Views, ViewModels, Models |
| `PixiEditor.ChangeableDocument/` | Document state + all operations (changes) |
| `ChunkyImageLib/` | Chunked pixel image (tile-based, OffscreenCanvas equivalent) |
| `Drawie/` | Skia rendering backend abstraction |
| `PixiEditor.SVG/` | SVG read/write |
| `ColorPicker/` | Color picker control |
| `PixiEditor.Zoombox/` | Pan/zoom viewport control |

---

## Feature → Source File Map

### Tools (ViewModels)
All in `src/PixiEditor/ViewModels/Tools/Tools/`

| Tool | File |
|---|---|
| Brush/Pen | `PenToolViewModel.cs`, `BrushBasedToolViewModel.cs` |
| Eraser | `EraserToolViewModel.cs` |
| Flood Fill | `FloodFillToolViewModel.cs` |
| Select (rect) | `SelectToolViewModel.cs` |
| Lasso | `LassoToolViewModel.cs` |
| Magic Wand | `MagicWandToolViewModel.cs` |
| Move | `MoveToolViewModel.cs` |
| Eyedropper | `ColorPickerToolViewModel.cs` |
| Text | `TextToolViewModel.cs` |
| Line | `RasterLineToolViewModel.cs`, `VectorLineToolViewModel.cs` |
| Rectangle | `RasterRectangleToolViewModel.cs`, `VectorRectangleToolViewModel.cs` |
| Ellipse | `RasterEllipseToolViewModel.cs`, `VectorEllipseToolViewModel.cs` |
| Zoom | `ZoomToolViewModel.cs` |
| Rotate Viewport | `RotateViewportToolViewModel.cs` |

### Tool Handler Interfaces
All in `src/PixiEditor/Models/Handlers/Tools/`
`IBrushToolHandler.cs`, `IEraserToolHandler.cs`, `IFloodFillToolHandler.cs`, `ISelectToolHandler.cs`, `ILassoToolHandler.cs`, `IMagicWandToolHandler.cs`, `IMoveToolHandler.cs`, `ITextToolHandler.cs`, `ILineToolHandler.cs`, `IRasterRectangleToolHandler.cs`, `IRasterEllipseToolHandler.cs`, `IColorPickerHandler.cs`, `IPenToolHandler.cs`

### Overlays (rendered on UI canvas layer)
All in `src/PixiEditor/Views/Overlays/`

| Overlay | File |
|---|---|
| **Free Transform** | `TransformOverlay/TransformOverlay.cs` |
| Transform math | `TransformOverlay/TransformHelper.cs` |
| Transform scale/rotate math | `TransformOverlay/TransformUpdateHelper.cs` |
| Transform state | `TransformOverlay/TransformState.cs`, `Anchor.cs` |
| Selection (marching ants) | `SelectionOverlay.cs` |
| Grid lines | `GridLinesOverlay.cs` |
| Reference layer | `ReferenceLayerOverlay.cs` |
| Symmetry axis | `SymmetryOverlay.cs` |
| Text editing | `TextOverlay.cs` |
| Line tool | `LineToolOverlay.cs` |
| Brush shape preview | `BrushShapeOverlay.cs` |
| Snapping guides | `SnappingOverlay.cs` |

### Document Operations (Changes)
All in `src/PixiEditor.ChangeableDocument/Changes/`
Each operation = one `_Change.cs` or `_UpdateableChange.cs` file.
Relevant ones:

| Operation | File |
|---|---|
| Free transform | `TransformSelected_UpdateableChange.cs` |
| Crop | `Crop_Change.cs` |
| Resize image | `ResizeImage_Change.cs` |
| Resize canvas | `ResizeCanvas_Change.cs` |
| Rotate image | `RotateImage_Change.cs` |
| Flood fill | `FloodFill_UpdateableChange.cs` (search for it) |
| Magic wand select | `MagicWand_UpdateableChange.cs` |
| Select rect | `SelectRectangle_UpdateableChange.cs` |
| Select lasso | `SelectLasso_UpdateableChange.cs` |
| Select ellipse | `SelectEllipse_UpdateableChange.cs` |
| Clear selected area | `ClearSelectedArea_Change.cs` |
| Set selection | `SetSelection_Change.cs` |
| Create layer | `CreateStructureMember_Change.cs` |
| Delete layer | `DeleteStructureMember_Change.cs` |
| Duplicate layer | `DuplicateLayer_Change.cs` |
| Merge layers | `CombineStructureMembersOnto_Change.cs` |
| Move layer | `MoveStructureMember_Change.cs` |
| Layer mask (create) | `CreateStructureMemberMask_Change.cs` |
| Layer mask (apply) | `ApplyLayerMask_Change.cs` |
| Layer mask (delete) | `DeleteStructureMemberMask_Change.cs` |
| Alpha lock | `LayerLockTransparency_Change.cs` |
| Clip to below | `StructureMemberClipToMemberBelow_Change.cs` |
| Blend mode | `StructureMemberBlendMode_Change.cs` |
| Opacity | `StructureMemberOpacity_UpdateableChange.cs` |
| Symmetry axis | `SymmetryAxisState_Change.cs`, `SymmetryAxisPosition_UpdateableChange.cs` |
| Replace color | `ReplaceColor_Change.cs` |
| Paste image | `PasteImage_UpdateableChange.cs` |
| Rasterize member | `RasterizeMember_Change.cs` |
| Draw rect | `DrawRasterRectangle_UpdateableChange.cs` |
| Draw ellipse | `DrawRasterEllipse_UpdateableChange.cs` |
| Draw line | `DrawRasterLine_UpdateableChange.cs` |
| Pixel perfect pen | `PixelPerfectPen_UpdateableChange.cs` |
| Path pen | `PathBasedPen_UpdateableChange.cs` |
| Line-based pen | `LineBasedPen_UpdateableChange.cs` |
| Shift layer | `ShiftLayer_UpdateableChange.cs` |
| Onion skin settings | `SetOnionSettings_Change.cs` |
| Reference layer | `SetReferenceLayer_Change.cs`, `TransformReferenceLayer_UpdateableChange.cs` |
| Animation: create cel | `CreateCel_Change.cs` |
| Animation: key frame | `SetKeyFrameData_Change.cs`, `KeyFrameLength_UpdateableChange.cs` |

### Document ViewModel
`src/PixiEditor/ViewModels/Document/DocumentViewModel.cs` — top-level document state  
`src/PixiEditor/ViewModels/Document/TransformOverlays/DocumentTransformViewModel.cs` — transform session logic

### Document Model
`src/PixiEditor.ChangeableDocument/Changeables/Document.cs` — core document (layers, animation, graph)

### Layer / Structure
`src/PixiEditor.ChangeableDocument/Changeables/` — `AnimationData.cs`, layer nodes in `Graph/Nodes/`

---

## Architecture Patterns

### MVVM flow
```
User input → ToolViewModel.OnPointerDown/Move/Up
           → ActionAccumulator.AddAction(change)
           → ChangeExecutionController.Execute(change)
           → Change.Apply(Document)
           → DocumentUpdater notifies ViewModels
           → Overlay re-renders
```

### Tool lifecycle
```csharp
// All tools implement:
OnLeftMouseButtonDown(MouseOnCanvasEventArgs args)
OnLeftMouseButtonUp(MouseOnCanvasEventArgs args)
OnMouseMove(MouseOnCanvasEventArgs args)
OnKeyDown / OnKeyUp
```

### Overlay system
- Overlays inherit `Overlay` (in `Views/Overlays/Overlay.cs`)
- Rendered on a transparent Avalonia layer above the canvas
- Use `Handle` sub-objects for interactive hit-testable zones
- Zoom-aware: all sizes divided by `ZoomScale`
- `Refresh()` triggers a re-render

### ChunkyImage (≈ OffscreenCanvas)
- Image split into 64×64 chunks
- `ChunkyImage.EnqueueOperation(IDrawOperation)` → lazy apply
- `CommitChanges()` → flush
- Equivalent to Pixoto's `Layer.canvas` + `layer.ctx`

### Transform math (already ported to Pixoto)
- `TransformHelper.cs` — anchor positions, cursor types, pixel alignment
- `TransformUpdateHelper.cs` — `UpdateShapeFromCorner`, `UpdateShapeFromSide`, `UpdateShapeFromRotation`
- `TransformState` = `{ Origin, ProportionalAngle1, ProportionalAngle2, OriginWasManuallyDragged }`
- `ShapeCorners` = `{ TopLeft, TopRight, BottomLeft, BottomRight }` (4 `VecD` points)

---

## Features NOT Yet in Pixoto (future phases)

| Feature | PixiEditor Location |
|---|---|
| Layer groups/folders | `CreateStructureMember_Change.cs` (type=Folder), `DuplicateFolder_Change.cs` |
| Layer masks | `CreateStructureMemberMask_Change.cs`, `ApplyLayerMask_Change.cs` |
| Alpha lock | `LayerLockTransparency_Change.cs` |
| Clip to below | `StructureMemberClipToMemberBelow_Change.cs` |
| Text tool | `TextToolViewModel.cs`, `TextOverlay.cs`, `TextOverlay.axaml` |
| Shape tools | `DrawRasterRectangle/Ellipse/Line_UpdateableChange.cs`, `VectorRectangle/Ellipse/LineToolViewModel.cs` |
| Gradient | `DecomposeGradientNode.cs` (node-based) |
| Symmetry | `SymmetryOverlay.cs`, `SymmetryAxisState_Change.cs` |
| Reference layer | `ReferenceLayerOverlay.cs`, `SetReferenceLayer_Change.cs` |
| Animation / timeline | `AnimationData.cs`, `CreateCel_Change.cs`, `SetKeyFrameData_Change.cs` |
| Onion skinning | `SetOnionSettings_Change.cs` |
| Viewport rotation | `RotateViewportToolViewModel.cs` |
| Rulers / guides | search `SnappingOverlay.cs`, `SnappingController.cs` |
| Filters | `ApplyFilterNode.cs`, `BlurNode.cs`, `ColorAdjustmentsFilterNode.cs`, `ColorMatrixFilterNode.cs` |
| Node graph | `src/PixiEditor.ChangeableDocument/Changeables/Graph/Nodes/` (all `*Node.cs` files) |
| Replace color | `ReplaceColor_Change.cs` |
| Pixel-perfect pen | `PixelPerfectPen_UpdateableChange.cs` |
| Dodge/Burn | `IBrightnessToolHandler.cs` |
| Clone stamp | not in source — would be custom |

---

## How to Find Anything

```bash
# Find feature by keyword
grep -rli "flood\|FloodFill" TEMP_TO_BE_REMOVED/PixiEditor-master/src/ --include="*.cs"

# Find all Change operations
ls TEMP_TO_BE_REMOVED/PixiEditor-master/src/PixiEditor.ChangeableDocument/Changes/

# Find overlay for a feature
ls TEMP_TO_BE_REMOVED/PixiEditor-master/src/PixiEditor/Views/Overlays/

# Find tool ViewModel
ls TEMP_TO_BE_REMOVED/PixiEditor-master/src/PixiEditor/ViewModels/Tools/Tools/
```

---

## Coordinate System Notes

- PixiEditor uses `VecD` (double-precision 2D vector) for canvas coords
- `ZoomScale` = current zoom factor (equivalent to `engine.zoom`)
- All handle sizes, line widths: divide by `ZoomScale` to get zoom-independent screen pixels
- `ShapeCorners.IsAlignedToPixels` → snap to integer coordinates
- `SnappingController.GetSnapDeltaForPoints(...)` → pixel snapping logic
