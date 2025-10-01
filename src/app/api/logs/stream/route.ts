// src/app/api/logs/stream/route.ts
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { getLogChannel, endLog } from '@/lib/logBus';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return new Response('Missing id', { status: 400 });

  const ch = getLogChannel(id);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: any) => {
        const payload = `event: ${event}\n` + `data: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(encoder.encode(payload));
      };

      const onLog = (msg: string) => send('log', { msg });
      const onDone = () => {
        send('done', {});
        controller.close();
      };

      ch.on('log', onLog);
      ch.once('done', onDone);
    },
    cancel() {
      endLog(id);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
