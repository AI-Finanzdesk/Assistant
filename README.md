# Projekt-Assistent

Eigen "Notion" voor projecten, kennis, meetings en e-mail – met een AI-assistent die meedenkt.

- **Projecten** (Anti-Diebstahlschutz, Dritz, …) met deelnemers en rechten per persoon
- **Kennisbank** met onderwerpen die in meerdere projecten terugkomen (energie-inkoop, THG-Quote, subsidies)
- **Meetings**: agenda automatisch opstellen → opnemen op telefoon/laptop → transcript → samenvatting,
  besluiten, actiepunten → na bevestiging in de Outlook-agenda
- **Delen per onderdeel**: een gast (bv. Timo) ziet alleen de delen van een verslag en de taken die aan hem zijn toegewezen
- **E-mail**: alleen de Outlook-mappen die je aan een project koppelt worden ingelezen en samengevat
- **Assistent**: analyseert wekelijks alles en stelt opvolging, taken, inzichten en verbeteringen aan de tool zelf voor
- Nederlands en Duits; werkt als app op de telefoon ("Zum Home-Bildschirm hinzufügen")

## Instellingen per gebruiker / projectdeelnemer

| Niveau | Instelling | Voorbeeld |
|---|---|---|
| Gebruiker | Kernteam (`is_internal`) | Jij en Michael: zien alle projecten + kennisbank. Timo: niet. |
| Gebruiker | Mailmappen synchroniseren | Jij en Michael aan, Timo uit |
| Gebruiker | Agenda-sync | Jij en Michael aan, Timo uit |
| Gebruiker | Taal | NL of DE |
| Projectdeelnemer | Rol: eigenaar / medewerker / gast | Timo = gast bij "Anti-Diebstahl" |
| Projectdeelnemer | Ziet alle verslagen | Gast standaard uit |
| Projectdeelnemer | Ziet e-mails | Gast standaard uit |
| Projectdeelnemer | Taken in agenda | Per project aan/uit |
| Verslagonderdeel | Ook zichtbaar voor … | Per onderdeel aanvinken (Claude doet een voorstel) |

De rechten worden in de database zelf afgedwongen (Postgres Row Level Security), niet alleen in de schermen.

## Techniek

Next.js 15 (App Router) · Supabase (Postgres, login, opslag – regio Frankfurt) · Claude (samenvatten, agenda,
analyse) · AssemblyAI EU (spraak → tekst, met sprekerherkenning) · Exchange Web Services (mail + agenda op eigen server; Microsoft Graph als optie voor Microsoft 365) ·
Vercel (hosting + cron-jobs).

## Installatie (eenmalig, ±45 minuten)

### 1. Supabase
1. Maak een account op supabase.com → **New project**, regio **Central EU (Frankfurt)**.
2. **SQL Editor** → voer na elkaar de bestanden uit `supabase/migrations/` uit (`0001_…`, dan `0002_…`) → **Run**.
3. **Authentication → Sign In / Providers**: zet **"Allow new users to sign up" uit** (alleen uitnodigingen).
4. **Authentication → URL Configuration**: Site URL = je app-URL (bv. `https://assistent.vercel.app`),
   en voeg `https://assistent.vercel.app/**` toe bij Redirect URLs.
5. **Project Settings → API**: noteer de URL, `anon`-key en `service_role`-key.
6. Maak jezelf aan: **Authentication → Users → Add user → Send invitation** met jouw e-mailadres.
   De eerste gebruiker wordt automatisch beheerder en kernteam.

### 2. Claude API
console.anthropic.com → API Keys → nieuwe key.

### 3. AssemblyAI (transcriptie)
assemblyai.com → account → API key. De app gebruikt de EU-server (`api.eu.assemblyai.com`).

### 4. Exchange-server (on-premise)
De app praat via **EWS (Exchange Web Services)** met jullie server – dezelfde techniek die Outlook voor Mac en
veel mobiele apps gebruiken. Daarmee werken zowel de mailmappen als de agenda. Ondersteund: Exchange 2010 SP2 en
nieuwer (2013/2016/2019/Subscription Edition), met NTLM- of Basic-aanmelding.

Vraag aan jullie IT-beheerder:
1. **Het EWS-adres**, meestal `https://mail.<jullie-domein>/EWS/Exchange.asmx`.
   Test: open dat adres in de browser → er moet een inlogvenster verschijnen.
2. **Is het vanaf internet bereikbaar?** De app draait in de cloud (Vercel), dus EWS moet net als
   Outlook Web Access (OWA) van buitenaf bereikbaar zijn, met een geldig certificaat (bv. Let's Encrypt).
   Staat er een firewall met IP-filter voor, dan heeft Vercel géén vaste IP-adressen – laat het weten, dan
   kiezen we een alternatief (kleine sync-dienst op jullie eigen netwerk die de mail doorstuurt).
3. **Aanmelding**: meestal NTLM (standaard). Als NTLM geblokkeerd is: Basic via HTTPS.

Zet het adres als `EWS_URL` in de omgevingsvariabelen; dan hoeven gebruikers alleen nog hun gebruikersnaam en
wachtwoord in te vullen. Maak ook een `CREDENTIALS_KEY` aan (`openssl rand -hex 32`): daarmee worden de
Exchange-wachtwoorden versleuteld opgeslagen.

> Stappen jullie later over naar Microsoft 365? Dan zit die koppeling er al in (Microsoft Graph, zie `.env.example`
> onder `MS_CLIENT_ID`). Per gebruiker kan gekozen worden.

### 5. Vercel
1. vercel.com → **Add New Project** → deze repository, **Root Directory: `projekt-assistent`**.
2. Vul de omgevingsvariabelen in uit `.env.example`. `WEBHOOK_SECRET` en `CRON_SECRET`: lange willekeurige
   strings (bv. `openssl rand -hex 32`).
3. Deploy. De cron-jobs uit `vercel.json` lopen automatisch: mail dagelijks om 05:15 UTC, assistent op maandag.
   Het gratis Hobby-plan staat maar 1 cron-run per dag toe. Met Vercel Pro kun je de mail-sync in `vercel.json`
   op `*/30 * * * *` zetten (elke 30 minuten). Tussendoor kan altijd: Instellingen → *Nu synchroniseren*.

### 6. In de app
1. Inloggen → **Instellingen**: naam, taal, mail-/agenda-sync aan → Exchange-gebruikersnaam en wachtwoord invullen → **Testen & koppelen**.
2. Mailmappen aan projecten koppelen.
3. Michael en Timo uitnodigen (Instellingen → Gebruikers). Michael: vinkje *Kernteam*. Timo: zonder.
4. Bij het project: Timo toevoegen als **Gast**.

## Lokaal ontwikkelen

```bash
cp .env.example .env.local   # invullen
npm install
npm run dev
```

## Privacy (DSGVO)
- Opnemen kan pas na bevestiging dat alle deelnemers akkoord zijn.
- Data staat in de EU (Supabase Frankfurt, AssemblyAI EU). Sluit met Supabase, Vercel, Anthropic en AssemblyAI
  een verwerkersovereenkomst (AVV/DPA) af – die bieden ze standaard aan.
- Exchange-wachtwoorden staan versleuteld (AES-256) in de database en zijn alleen server-side leesbaar.
- Mail buiten de gekoppelde mappen wordt nooit opgehaald.
