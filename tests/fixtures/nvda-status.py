"""Optional NVDA scratchpad instrumentation for the disposable WebView2 suite.

Set PAM_NVDA_SPEECH_LOG before starting NVDA with an isolated config directory.
Only speech for modal-test-host is recorded. The synthesizer is not replaced.
"""
import json
import os
from pathlib import Path
import api
import globalPluginHandler
from speech import pre_speech

class GlobalPlugin(globalPluginHandler.GlobalPlugin):
    def __init__(self):
        super().__init__()
        self.log = Path(os.environ['PAM_NVDA_SPEECH_LOG'])
        pre_speech.register(self.capture)
        self.write({'event': 'plugin-ready'})

    def write(self, event):
        with self.log.open('a', encoding='utf-8') as stream:
            stream.write(json.dumps(event, ensure_ascii=False) + '\n')

    def capture(self, speechSequence, **kwargs):
        foreground = api.getForegroundObject()
        if not foreground or foreground.appModule.appName != 'modal-test-host':
            return
        text = ' '.join(item for item in speechSequence if isinstance(item, str))
        if text:
            self.write({'event': 'speech', 'text': text})

    def terminate(self):
        pre_speech.unregister(self.capture)
        super().terminate()
