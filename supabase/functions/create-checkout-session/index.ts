import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.98.0';
import Stripe from 'https://esm.sh/stripe@20.4.0';

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY');
const supabaseUrl = Deno.env.get('SUPABASE_URL');
const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const appUrl = Deno.env.get('APP_URL');

const stripe = stripeSecretKey ? new Stripe(stripeSecretKey) : null;
const supabase = (supabaseUrl && supabaseServiceRoleKey)
    ? createClient(supabaseUrl, supabaseServiceRoleKey)
    : null;

export default async function handler(req: Request): Promise<Response> {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    if (req.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'Method not allowed' }), {
            status: 405,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }

    if (!stripe) {
        return new Response(JSON.stringify({ error: 'Stripe not configured' }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }

    try {
        const { priceId, userId } = await req.json();

        console.log("Incoming request:", { priceId, userId });

        if (!userId) {
            return new Response(JSON.stringify({ error: 'Missing userId' }), {
                status: 400,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        if (!priceId) {
            return new Response(JSON.stringify({ error: 'Missing priceId' }), {
                status: 400,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        // Verify environment
        if (!stripeSecretKey) {
            console.error("Missing STRIPE_SECRET_KEY environment variable");
            return new Response(JSON.stringify({ error: 'Stripe configuration error' }), {
                status: 500,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        if (!appUrl) {
            console.error("Missing APP_URL environment variable, using default");
            // For Vercel deployments, try to construct the URL from the request
            // This is a fallback - ideally APP_URL should be set in Supabase
            const requestUrl = new URL(req.url);
            const defaultAppUrl = `${requestUrl.protocol}//${requestUrl.hostname}`;
            console.log(`Using default APP_URL: ${defaultAppUrl}`);
            // Override appUrl for this request
            (globalThis as any).appUrl = defaultAppUrl;
        }

        // Check if priceId matches test/live mode
        const isTestMode = stripeSecretKey.startsWith('sk_test_');
        const isPriceTest = priceId.startsWith('price_1'); // Most test prices start with price_1

        if (isTestMode && !isPriceTest) {
            console.error("Price ID appears to be for live mode but using test Stripe key - continuing anyway");
            // Don't fail, just log the warning
        }

        if (!isTestMode && isPriceTest) {
            console.error("Price ID appears to be for test mode but using live Stripe key - continuing anyway");
            // Don't fail, just log the warning
        }

        console.log("Creating Stripe checkout session with:", {
            priceId,
            userId,
            mode: 'subscription',
            success_url: `${(globalThis as any).appUrl || appUrl}/profile?success=true`,
            cancel_url: `${(globalThis as any).appUrl || appUrl}/profile?canceled=true`
        });

        try {
            const session = await stripe.checkout.sessions.create({
                payment_method_types: ['card'],
                line_items: [{ price: priceId, quantity: 1 }],
                mode: 'subscription',
                success_url: `${(globalThis as any).appUrl || appUrl}/profile?success=true`,
                cancel_url: `${(globalThis as any).appUrl || appUrl}/profile?canceled=true`,
                client_reference_id: userId,
            });

            console.log("Stripe session created successfully:", { sessionId: session.id, url: session.url });

            return new Response(JSON.stringify({ url: session.url }), {
                status: 200,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        } catch (stripeErr: any) {
            console.error("Stripe error:", stripeErr);
            return new Response(JSON.stringify({ error: stripeErr.message }), {
                status: 500,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }
    } catch (err: any) {
        console.error("General error:", err);
        return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }
}