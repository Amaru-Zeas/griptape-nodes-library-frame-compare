from __future__ import annotations

import math
from typing import Any

from griptape_nodes.exe_types.core_types import Parameter, ParameterMode
from griptape_nodes.exe_types.node_types import DataNode
from griptape_nodes.retained_mode.events.static_file_events import (
    CreateStaticFileDownloadUrlFromPathRequest,
    CreateStaticFileDownloadUrlResultSuccess,
)
from griptape_nodes.retained_mode.griptape_nodes import GriptapeNodes
from griptape_nodes.traits.widget import Widget

LIBRARY_NAME = "Frame Compare"
WIDGET_NAME = "FrameCompareWidget"


def _default_state() -> dict[str, Any]:
    return {
        "plate": "",
        "mask": "",
        "plateSource": "",
        "maskSource": "",
        "plateError": "",
        "maskError": "",
        "plateDuration": 0.0,
        "maskDuration": 0.0,
        "loop": True,
        "timelineFrames": 0,
        "fps": 24,
        "frame": 0,
        "mode": "quad",
        "wipe": 0.5,
        "invert": False,
    }


def _resolve_url(value: Any) -> str:
    """Read a URL off an artifact. Never call the value; resolution proxies are not functions."""
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, dict):
        for key in ("url", "value", "path"):
            item = value.get(key)
            if isinstance(item, str) and item.strip():
                return item.strip()
        return ""
    for attr in ("value", "url"):
        try:
            item = getattr(value, attr, None)
        except Exception:
            continue
        if callable(item):
            continue
        if isinstance(item, str) and item.strip():
            return item.strip()
    return ""


def _positive_float(value: Any) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError):
        return 0.0
    if number != number or number <= 0.0 or number > 1_000_000.0:
        return 0.0
    return number


def _browser_url(source: str) -> str:
    """Use the same engine conversion as the built-in media players.

    Artifact values can be project macros, file URIs, or Windows paths. A
    browser cannot load those directly; the engine resolves and serves them.
    """
    if not source:
        return ""
    if source.startswith(("http://", "https://", "blob:", "data:")) and "cloud.griptape.ai" not in source:
        return source
    result = GriptapeNodes.handle_request(
        CreateStaticFileDownloadUrlFromPathRequest(
            file_path=source, preview=False, broadcast_result=False,
        )
    )
    if isinstance(result, CreateStaticFileDownloadUrlResultSuccess) and result.url:
        return result.url
    raise ValueError(getattr(result, "result_details", "Could not resolve the video source."))


def _fps(state: dict[str, Any]) -> int:
    try:
        fps = math.floor(float(state.get("fps", 24)) + 0.5)
    except (TypeError, ValueError, OverflowError):
        fps = 24
    return max(1, min(120, fps))


def _frames_for(duration: float, fps: int) -> int:
    if duration <= 0.0:
        return 0
    return max(1, math.floor(duration * fps + 0.5))


def timeline_frames(state: dict[str, Any]) -> int:
    """Custom frame count wins. Otherwise the longer of plate and mask, in frames."""
    try:
        custom = math.floor(float(state.get("timelineFrames") or 0) + 0.5)
    except (TypeError, ValueError, OverflowError):
        custom = 0
    if custom > 0:
        return min(200_000, custom)
    fps = _fps(state)
    plate = _frames_for(_positive_float(state.get("plateDuration")), fps)
    mask = _frames_for(_positive_float(state.get("maskDuration")), fps)
    return max(plate, mask)


class FrameCompareNode(DataNode):
    """Plate and mask in. The widget builds the four review quadrants."""

    def __init__(self, name: str, metadata: dict[str, Any] | None = None, **kwargs) -> None:
        node_metadata = {
            "category": "FrameCompare",
            "description": "Plate and mask. Four quadrants are built in the viewer. Stepped by frame.",
        }
        if metadata:
            node_metadata.update(metadata)
        super().__init__(name=name, metadata=node_metadata, **kwargs)
        self.set_initial_node_size(width=980, height=820)
        self._syncing = False

        self._add_video_input("plate", "Plate", "Source plate.")
        self._add_video_input("mask", "Mask", "Matte. White keeps the plate in Checker and Green.")

        self.add_parameter(
            Parameter(
                name="compare",
                input_types=["dict"],
                type="dict",
                default_value=_default_state(),
                tooltip="Plate, mask, checker, and green. Left and right arrows step one frame.",
                allowed_modes={ParameterMode.PROPERTY},
                ui_options={"is_full_width": True, "display_name": "Compare"},
                traits={Widget(name=WIDGET_NAME, library=LIBRARY_NAME)},
            )
        )
        self.add_parameter(
            Parameter(
                name="frames",
                output_type="int",
                tooltip="Timeline length in frames. A custom count wins; otherwise the longer clip.",
                allowed_modes={ParameterMode.OUTPUT},
                settable=False,
            )
        )
        self.add_parameter(
            Parameter(
                name="loop",
                output_type="bool",
                tooltip="When on, the shorter clip repeats across the frame range.",
                allowed_modes={ParameterMode.OUTPUT},
                settable=False,
            )
        )

    def _add_video_input(self, name: str, display: str, tooltip: str) -> None:
        # VideoUrlArtifact so a video wire passes through. hide_property skips the built-in player.
        self.add_parameter(
            Parameter(
                name=name,
                input_types=["VideoUrlArtifact", "VideoArtifact"],
                type="VideoUrlArtifact",
                tooltip=tooltip,
                allowed_modes={ParameterMode.INPUT},
                ui_options={"display_name": display, "hide_property": True},
            )
        )

    def _viewer_state(self) -> dict[str, Any]:
        # BaseNode._state is a NodeResolutionState, never a callable helper.
        value = self.get_parameter_value("compare")
        state = _default_state()
        if isinstance(value, dict):
            state.update(value)
        state["plate"] = state.get("plate") if isinstance(state.get("plate"), str) else ""
        state["mask"] = state.get("mask") if isinstance(state.get("mask"), str) else ""
        return state

    def _push_state(self, state: dict[str, Any]) -> None:
        self._syncing = True
        try:
            self.set_parameter_value("compare", state)
            self.publish_update_to_parameter("compare", state)
        finally:
            self._syncing = False

    @staticmethod
    def _next_url(current: str, value: Any) -> str | None:
        incoming = _resolve_url(value)
        if incoming:
            return incoming
        if value is None or value == "":
            return ""
        return None

    def _write_ref(self, key: str, value: Any, *, refresh: bool = False) -> None:
        state = self._viewer_state()
        current = state.get(key + "Source") or state[key]
        source = self._next_url(current, value)
        if source is None:
            return
        if not refresh and current == source and state[key].startswith(("http://", "https://", "blob:", "data:")):
            return
        if not source and not current and not state.get(key + "Error"):
            return
        try:
            state[key] = _browser_url(source)
            state[key + "Error"] = ""
        except (ValueError, OSError) as error:
            state[key] = ""
            state[key + "Error"] = f"{key.title()}: {error}"
        state[key + "Source"] = source
        if current != source:
            state[key + "Duration"] = 0.0
            state["frame"] = 0
        self._push_state(state)

    def _apply_inputs(self, *, refresh: bool = False) -> None:
        for key in ("plate", "mask"):
            self._write_ref(key, self.get_parameter_value(key), refresh=refresh)

    def _publish_outputs(self, state: dict[str, Any]) -> None:
        frames = timeline_frames(state)
        loop = state.get("loop") is not False
        self.parameter_output_values["frames"] = frames
        self.parameter_output_values["loop"] = loop
        self.publish_update_to_parameter("frames", frames)
        self.publish_update_to_parameter("loop", loop)

    def after_value_set(self, parameter: Parameter, value: Any) -> None:
        if not self._syncing:
            name = parameter.name
            if name in ("plate", "mask"):
                self._write_ref(name, value)
                self._publish_outputs(self._viewer_state())
            elif name == "compare" and isinstance(value, dict):
                self._apply_inputs()
                self._publish_outputs(self._viewer_state())
        return super().after_value_set(parameter, value)

    def after_incoming_connection_removed(
        self,
        source_node: Any,
        source_parameter: Parameter,
        target_parameter: Parameter,
    ) -> None:
        name = getattr(target_parameter, "name", "")
        if name in ("plate", "mask"):
            self._write_ref(name, None)
            self._publish_outputs(self._viewer_state())
        return super().after_incoming_connection_removed(source_node, source_parameter, target_parameter)

    def process(self) -> None:
        # Refresh engine-issued URLs on execution, including expired cloud links.
        self._apply_inputs(refresh=True)
        self._publish_outputs(self._viewer_state())
