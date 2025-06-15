export interface Env {
	DB: D1Database;
}

// すべての応答にCORSヘッダーを追加するヘルパー関数
function withCors(response: Response): Response {
    const newHeaders = new Headers(response.headers);
    newHeaders.set('Access-Control-Allow-Origin', '*');
    newHeaders.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    newHeaders.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders,
    });
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        // プリフライトリクエスト(OPTIONS)には、常に成功応答を返す
        if (request.method === 'OPTIONS') {
            return new Response(null, {
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
                },
            });
        }

        const url = new URL(request.url);

        try {
            // --- APIルーティング ---
            if (url.pathname === '/api/data') {
                // ... (GET /api/data の処理) ...
                const month = url.searchParams.get('month');
                if (!month) return withCors(new Response('Month query parameter is required', { status: 400 }));

                const shiftsStmt = env.DB.prepare(`SELECT s.id, s.user_id as userId, u.name as fullName, u.role, s.shift_date as shiftDate, s.time, s.break_time as breakTime, s.notes FROM shifts s JOIN users u ON s.user_id = u.id WHERE strftime('%Y-%m', s.shift_date) = ?`).bind(month);
                const usersStmt = env.DB.prepare('SELECT * FROM users ORDER BY id');
                const manualBreaksStmt = env.DB.prepare("SELECT * FROM manual_breaks WHERE strftime('%Y-%m', shift_date) = ?").bind(month);
                const manualShortagesStmt = env.DB.prepare("SELECT * FROM manual_shortages WHERE strftime('%Y-%m', shift_date) = ?").bind(month);

                const [shiftsResult, usersResult, manualBreaksResult, manualShortagesResult] = await Promise.all([
                    shiftsStmt.all(), usersStmt.all(), manualBreaksStmt.all(), manualShortagesStmt.all()
                ]);
                const data = {
                    users: usersResult.results,
                    shifts: (shiftsResult.results || []).reduce<Record<string, any[]>>((acc, shift) => { const date = shift.shiftDate as string; if (!acc[date]) acc[date] = []; acc[date].push(shift); return acc; }, {}),
                    manualBreaks: (manualBreaksResult.results || []).reduce((acc, item) => { acc[item.shift_date as string] = item.break_text; return acc; }, {}),
                    manualShortages: (manualShortagesResult.results || []).reduce((acc, item) => { acc[item.shift_date as string] = item.shortage_text; return acc; }, {}),
                };
                return withCors(new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } }));

            } else if (url.pathname === '/api/shift' && request.method === 'POST') {
                // ... (POST /api/shift の処理) ...
                const { userId, date, time, breakTime, notes } = await request.json<any>();
                if (!userId || !date) return withCors(new Response('userId and date are required', { status: 400 }));

                await env.DB.prepare('DELETE FROM shifts WHERE user_id = ? AND shift_date = ?').bind(userId, date).run();
                if (time) {
                    await env.DB.prepare('INSERT INTO shifts (user_id, shift_date, time, break_time, notes) VALUES (?, ?, ?, ?, ?)').bind(userId, date, time || null, breakTime || null, notes || null).run();
                }
                return withCors(new Response('Shift updated successfully', { status: 200 }));

            } else if (url.pathname === '/api/manuals' && request.method === 'POST') {
                // ... (POST /api/manuals の処理) ...
                const { date, breaks, shortages } = await request.json<any>();
                if (!date) return withCors(new Response('Date is required', { status: 400 }));
                
                if(breaks !== undefined) await env.DB.prepare('INSERT OR REPLACE INTO manual_breaks (shift_date, break_text) VALUES (?, ?)').bind(date, breaks).run();
                if(shortages !== undefined) await env.DB.prepare('INSERT OR REPLACE INTO manual_shortages (shift_date, shortage_text) VALUES (?, ?)').bind(date, shortages).run();

                return withCors(new Response('Manual data updated', { status: 200 }));
            }

            // どのパスにも一致しない場合
            return withCors(new Response('Not Found', { status: 404 }));

        } catch (e: any) {
            // プログラム全体で予期せぬエラーが発生した場合
            console.error("Unhandled Error:", e);
            return withCors(new Response(`Internal Server Error: ${e.message}`, { status: 500 }));
        }
	},
};
