"""Run with the Python interpreter used by Griptape Nodes: python -m unittest discover -s tests."""
import math
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from griptape_nodes.exe_types.node_types import NodeResolutionState
from griptape_nodes.retained_mode.events.static_file_events import (
    CreateStaticFileDownloadUrlFromPathResultSuccess,
    CreateStaticFileDownloadUrlResultFailure,
)
from frame_compare_nodes.frame_compare_node import FrameCompareNode, _browser_url, _resolve_url, timeline_frames


class FrameCompareTests(unittest.TestCase):
    def setUp(self):
        # Use real Parameters, BaseNode and callbacks; isolate only outbound events.
        self.events = patch('griptape_nodes.retained_mode.griptape_nodes.GriptapeNodes.EventManager')
        self.events.start()
        self.addCleanup(self.events.stop)
        self.node = FrameCompareNode('Frame Compare regression')

    def test_process_preserves_engine_resolution_state(self):
        self.node.state = NodeResolutionState.RESOLVING
        self.node.process()
        self.assertIs(self.node.state, NodeResolutionState.RESOLVING)
        self.assertEqual(self.node.parameter_output_values['frames'], 0)
        self.assertTrue(self.node.parameter_output_values['loop'])

    def test_wire_updates_preserve_review_settings(self):
        self.node.set_parameter_value('compare', {'fps': 30, 'mode': 'wipe', 'timelineFrames': 300})
        self.node.set_parameter_value('plate', {'value': 'https://example.test/plate.mp4'})
        self.node.set_parameter_value('mask', {'url': 'https://example.test/mask.mp4'})
        state = self.node.get_parameter_value('compare')
        self.assertEqual(state['plate'], 'https://example.test/plate.mp4')
        self.assertEqual(state['mask'], 'https://example.test/mask.mp4')
        self.assertEqual(state['mode'], 'wipe')
        self.assertEqual(self.node.parameter_output_values['frames'], 300)

    def test_metadata_publishes_shared_timeline(self):
        self.node.set_parameter_value('plate', 'https://example.test/plate.mp4')
        self.node.set_parameter_value('mask', 'https://example.test/mask.mp4')
        state = self.node.get_parameter_value('compare') | {'plateDuration': 5, 'maskDuration': 7, 'fps': 24, 'loop': False}
        self.node.set_parameter_value('compare', state)
        self.node.process()
        self.assertEqual(self.node.parameter_output_values['frames'], 168)
        self.assertFalse(self.node.parameter_output_values['loop'])

    def test_replacing_clip_clears_old_metadata(self):
        self.node.set_parameter_value('plate', 'https://example.test/old.mp4')
        state = self.node.get_parameter_value('compare') | {'plateDuration': 100, 'frame': 900}
        self.node.set_parameter_value('compare', state)
        self.node.set_parameter_value('plate', 'https://example.test/new.mp4')
        state = self.node.get_parameter_value('compare')
        self.assertEqual(state['plateDuration'], 0)
        self.assertEqual(state['frame'], 0)
        self.assertEqual(self.node.parameter_output_values['frames'], 0)

    def test_clearing_input_removes_stale_reference(self):
        self.node.set_parameter_value('plate', 'https://example.test/plate.mp4')
        self.node.set_parameter_value('plate', None)
        self.node.process()
        self.assertEqual(self.node.get_parameter_value('compare')['plate'], '')

    def test_disconnect_callback_clears_viewer(self):
        self.node.set_parameter_value('mask', 'https://example.test/mask.mp4')
        parameter = self.node.get_parameter_by_name('mask')
        self.node.after_incoming_connection_removed(self.node, parameter, parameter)
        self.assertEqual(self.node.get_parameter_value('compare')['mask'], '')

    def test_timeline_and_invalid_saved_values(self):
        self.assertEqual(timeline_frames({'plateDuration': 5, 'maskDuration': 7, 'fps': 24}), 168)
        self.assertEqual(timeline_frames({'maskDuration': 7, 'fps': 24, 'timelineFrames': 100}), 100)
        self.assertEqual(timeline_frames({'plateDuration': 1.125, 'fps': 12}), 14)
        for invalid in (math.nan, math.inf, -math.inf, None, 'bad'):
            with self.subTest(invalid=invalid):
                self.assertEqual(timeline_frames({'fps': invalid, 'timelineFrames': invalid, 'plateDuration': invalid}), 0)
        self.assertEqual(timeline_frames({'timelineFrames': 999999}), 200000)

    def test_artifact_url_without_calling_proxies(self):
        self.assertEqual(_resolve_url(SimpleNamespace(value='https://example.test/video.mp4')), 'https://example.test/video.mp4')
        self.assertEqual(_resolve_url(NodeResolutionState.RESOLVING), 'resolving')
        self.assertEqual(_resolve_url(SimpleNamespace(value=lambda: self.fail('Called artifact value'))), '')

    @patch('frame_compare_nodes.frame_compare_node.GriptapeNodes.handle_request')
    def test_macro_and_local_paths_use_native_media_conversion(self, request):
        request.return_value = CreateStaticFileDownloadUrlFromPathResultSuccess(
            url='http://localhost:8124/workspace/inputs/videos/plate.mp4', result_details='OK',
        )
        for source in ('{inputs}/videos/plate.mp4', 'file:///A:/Shots/plate.mp4', r'A:\Shots\plate.mp4'):
            with self.subTest(source=source):
                self.assertTrue(_browser_url(source).startswith('http://localhost:'))
                args = request.call_args.args[0]
                self.assertEqual(args.file_path, source)
                self.assertFalse(args.preview)

    @patch('frame_compare_nodes.frame_compare_node.GriptapeNodes.handle_request')
    def test_resolved_url_is_not_overwritten_by_widget_metadata(self, request):
        request.return_value = CreateStaticFileDownloadUrlFromPathResultSuccess(
            url='http://localhost:8124/workspace/inputs/videos/plate.mp4', result_details='OK',
        )
        self.node.set_parameter_value('plate', {'value': '{inputs}/videos/plate.mp4'})
        state = self.node.get_parameter_value('compare')
        self.assertEqual(state['plateSource'], '{inputs}/videos/plate.mp4')
        self.assertTrue(state['plate'].startswith('http://localhost:'))
        self.node.set_parameter_value('compare', state | {'plateDuration': 8})
        self.assertEqual(request.call_count, 1)
        self.assertEqual(self.node.parameter_output_values['frames'], 192)
        self.node.process()
        self.assertEqual(request.call_count, 2)
        self.assertEqual(self.node.get_parameter_value('compare')['plateDuration'], 8)

    @patch('frame_compare_nodes.frame_compare_node.GriptapeNodes.handle_request')
    def test_migration_converts_old_raw_macro_viewer_values(self, request):
        request.return_value = CreateStaticFileDownloadUrlFromPathResultSuccess(
            url='http://localhost:8124/workspace/inputs/videos/plate.mp4', result_details='OK',
        )
        self.node.set_parameter_value('plate', {'value': '{inputs}/videos/plate.mp4'}, initial_setup=True)
        self.node.set_parameter_value('compare', {'plate': '{inputs}/videos/plate.mp4'}, initial_setup=True)
        self.node.process()
        self.assertTrue(self.node.get_parameter_value('compare')['plate'].startswith('http://localhost:'))

    @patch('frame_compare_nodes.frame_compare_node.GriptapeNodes.handle_request')
    def test_conversion_error_is_visible_and_can_be_retried(self, request):
        request.return_value = CreateStaticFileDownloadUrlResultFailure(error='Missing input', result_details='Missing input')
        self.node.set_parameter_value('plate', {'value': '{inputs}/missing.mp4'})
        self.assertEqual(self.node.get_parameter_value('compare')['plate'], '')
        self.assertIn('Missing input', self.node.get_parameter_value('compare')['plateError'])
        request.return_value = CreateStaticFileDownloadUrlFromPathResultSuccess(url='http://localhost:8124/video.mp4', result_details='OK')
        self.node.process()
        self.assertEqual(self.node.get_parameter_value('compare')['plateError'], '')


if __name__ == '__main__':
    unittest.main()
