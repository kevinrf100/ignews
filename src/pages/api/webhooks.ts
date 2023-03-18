import { NextApiRequest, NextApiResponse } from "next";
import { Readable } from "stream";
import Stripe from "stripe";
import { stripe } from "../../services/stripe";
import { saveSubscription } from "./_lib/manageSubscription";

async function buffer(readable: Readable) {
    const chunks = [];
    for await (const chunk of readable) {
        chunks.push(
            typeof chunk === "string" ? Buffer.from(chunk) : chunk
        );
    }

    return Buffer.concat(chunks);
} 

export const config = {
    api: {
        bodyParser: false
    }
}

const relevantEvents = new Set([
    'checkout.session.completed',
    'customer.subscription.updated',
    'customer.subscription.deleted',
]);

export default async function handler(request: NextApiRequest, response: NextApiResponse) {
    if(request.method === 'POST') {
        const buf = await buffer(request);    
        const secret = request.headers['stripe-signature'];

        let event:  Stripe.Event;

        try{
            event = stripe.webhooks.constructEvent(buf, secret!, process.env.STRIPE_WEBHOOKS_SECRET!);
        } catch(error: any) {
            return response.status(400).send(`Webhooks error: ${error.message}`)
        }

        const { type } = event;

        if(relevantEvents.has(type)){
            try {
                switch (type) {
                    case 'customer.subscription.updated':
                    case 'customer.subscription.deleted':
                        const subscription = event.data.object as Stripe.Subscription;

                        await saveSubscription(
                            subscription.id, 
                            subscription.customer.toString(),
                            false
                        );

                        break;
                    case 'checkout.session.completed':
                        const checkoutSession = event.data.object as Stripe.Checkout.Session;
                        if(checkoutSession.subscription && checkoutSession.customer) {
                            await saveSubscription(
                                checkoutSession.subscription.toString(), 
                                checkoutSession.customer.toString(),
                                true
                            );
                        }else {
                            throw new Error("Unhandled event!");
                        }
                        break;
                
                    default:
                        throw new Error("Unhandled event!");
                } 
            } catch (error) {
                return response.json({error: 'Webhook handler failed!'})
            }
            
        }

        response.json({ok: true});
    } else {
        response.setHeader('allow', 'POST');
        response.status(405).end('Method Not Allowed');
    }
}