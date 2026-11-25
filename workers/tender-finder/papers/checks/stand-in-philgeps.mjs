// A stand-in for PhilGEPS on this computer (127.0.0.1), for checking the papers run without ever
// touching the real site or the real account: its log-in and log-out, a notice's "order" at no
// cost with its file, a notice that asks a payment, a closed notice. It answers the pages
// papers/lib/philgepsSync.mjs asks for, in the shape that code reads.
//
//   import { startPhilgeps } from './stand-in-philgeps.mjs'
//   const site = await startPhilgeps({ user, password, file: { name, bytes } })
//   site.host, site.state (what happened), await site.close()
//
// Run by itself it stays up and prints its address (for a hand check with a local CRM):
//   node papers/checks/stand-in-philgeps.mjs path/to/a.pdf

import http from 'node:http';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const USER_ID = '777';

export async function startPhilgeps({ user = 'company', password = 'right-password', file, free = '13000001', paid = '13000002', closed = '13000003' } = {}) {
    const state = { logins: 0, posts: 0, refused: 0, loggedIn: new Set(), cleared: new Set(), orders: new Map(), baskets: new Map(), downloads: 0, requests: 0 };
    const page = (action, body) => `<html><body><form method="post" action="${action}"><input type="hidden" name="__VIEWSTATE" value="vs"/>${body}</form></body></html>`;
    const orderPage = (ref, orderNo) =>
        page(
            `./OrderConfirmationUI.aspx?DirectFrom=MyOpportunities&amp;OrderID=${orderNo}&amp;refID=${ref}`,
            `<table><tr><td>${ref}</td> <td>Supply of medicines</td> <td>Download</td> <td><a href="javascript:__doPostBack('dgItems$ctl02$lbDoc','')">Bidding Documents</a></td></tr></table>`,
        );
    // (the real pages have white space between their cells; the reader's text of a page depends on it)
    const totals = (amount) => `<table><tr><td>Handling Fees</td> <td>Php 0.00</td></tr> <tr><td>Subtotal</td> <td>Php ${amount}</td></tr> <tr><td>Tax</td> <td>Php 0.00</td></tr> <tr><td>Total</td> <td>Php ${amount}</td></tr></table>`;

    const server = http.createServer(async (req, res) => {
        state.requests++;
        const url = new URL(req.url, 'http://127.0.0.1');
        const cookie = /ASP\.NET_SessionId=([^;]+)/.exec(req.headers.cookie || '')?.[1] || '';
        const inside = state.loggedIn.has(cookie);
        let body = '';
        for await (const chunk of req) body += chunk;
        const form = new URLSearchParams(body);
        const send = (status, html, headers = {}) => {
            res.writeHead(status, { 'content-type': 'text/html', ...headers });
            res.end(html);
        };
        const to = (location) => send(302, '', { location });
        const name = url.pathname.toLowerCase();

        if (name === '/geps/log-in.aspx') {
            const fresh = randomUUID();
            const refusedNote = url.searchParams.has('refused') ? "<script>alert('Invalid User ID or Password.');</script>" : '';
            return send(200, page('./logInAction.aspx', `<input name="userName" id="userName"/><input type="password" name="password"/>${refusedNote}`), { 'set-cookie': `ASP.NET_SessionId=${fresh}; path=/` });
        }
        if (name === '/geps/loginaction.aspx') {
            state.posts++;
            if (form.get('userName') === user && form.get('password') === password) {
                state.logins++;
                state.loggedIn.add(cookie);
                return to('/GEPS/Tender/PendingTaskUI.aspx');
            }
            state.refused++;
            return to('/GEPS/log-in.aspx?refused=1');
        }
        if (name === '/geps/responsewrite.aspx') return send(200, inside ? `${USER_ID}-1-2-x` : '');
        if (name === '/p4_webservices/gepsr3_common_service.asmx/clearpassphrasecached') {
            if (inside) state.cleared.add(cookie);
            return send(200, '{}');
        }
        if (name === '/geps/logoutredirect.aspx') {
            if (state.cleared.has(cookie)) state.loggedIn.delete(cookie);
            return to('/GEPS/log-in.aspx');
        }
        // Everything below is for a logged-in session only
        if (!inside) return to('/GEPS/log-in.aspx');
        if (name === '/geps/tender/pendingtaskui.aspx') return send(200, page('./PendingTaskUI.aspx', 'Pending Task <a href="#">Log-out</a>'));

        const ref = url.searchParams.get('refID') || '';
        if (name === '/geps/tender/vieworderassoccompui.aspx') {
            const orderNo = state.orders.get(ref);
            return send(200, page(`./ViewOrderAssocCompUI.aspx?refID=${ref}`, orderNo ? `<a href="javascript:__doPostBack('dgOrderDoc$ctl02$lbOrder','')">${orderNo}</a>` : 'No orders.'));
        }
        if (name === '/geps/tender/bidnoticeabstractui.aspx') {
            if (req.method === 'POST' && /lbtnNosOfAssoc/.test(form.get('__EVENTTARGET') || '')) {
                if (ref === closed) return send(200, page(`./BidNoticeAbstractUI.aspx?refID=${ref}`, "<script>alert('This notice is closed.');</script>"));
                state.baskets.set(cookie, ref);
                return send(200, page(`./BidNoticeAbstractUI.aspx?refID=${ref}`, 'Added to the order basket.'));
            }
            return send(200, page(`./BidNoticeAbstractUI.aspx?refID=${ref}`, `Bid Notice Abstract ${ref} <a href="javascript:__doPostBack('lbtnNosOfAssoc','')">Order</a>`));
        }
        if (name === '/geps/tender/orderbasketui.aspx') {
            const wanted = state.baskets.get(cookie);
            if (req.method === 'POST') return to('/GEPS/Tender/OrderConfirmationUI.aspx?ClickFrom=Basket');
            return send(200, page('./OrderBasketUI.aspx?ClickFrom=OpenOpp&amp;OrginFrom=PendTask', `Order Basket ${wanted || ''} ${totals(wanted === paid ? '500.00' : '0.00')}<input type="submit" name="btnCont" value="Continue"/>`));
        }
        if (name === '/geps/tender/orderconfirmationui.aspx') {
            const orderNo = url.searchParams.get('OrderID');
            // A document link pressed on an order's page: the file
            if (req.method === 'POST' && orderNo && /lbDoc/.test(form.get('__EVENTTARGET') || '')) {
                state.downloads++;
                res.writeHead(200, { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="${file.name}"` });
                return res.end(file.bytes);
            }
            if (orderNo) return send(200, orderPage(ref, orderNo));
            const wanted = state.baskets.get(cookie);
            if (req.method === 'POST' && form.has('btnSubmit')) {
                const made = String(5550 + state.orders.size + 1);
                state.orders.set(wanted, made);
                state.baskets.delete(cookie);
                return to(`/GEPS/Tender/OrderConfirmationUI.aspx?DirectFrom=OrderBasket&OrderID=${made}&refID=${wanted}`);
            }
            return send(200, page('./OrderConfirmationUI.aspx?ClickFrom=Basket', `Order Confirmation ${wanted || ''} ${totals('0.00')}<input type="submit" name="btnSubmit" value="Submit"/>`));
        }
        return send(404, 'not here');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    return { host: `http://127.0.0.1:${server.address().port}`, state, refs: { free, paid, closed }, close: () => new Promise((resolve) => server.close(resolve)) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const given = process.argv[2];
    if (!given) throw new Error('Give a PDF to serve as the bid document');
    const site = await startPhilgeps({ file: { name: path.basename(given), bytes: fs.readFileSync(given) } });
    console.log(`Stand-in PhilGEPS at ${site.host} (user "company", password "right-password"); notices ${Object.values(site.refs).join(', ')}`);
}
