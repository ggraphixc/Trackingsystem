import Link from "next/link";
import {
  AlertTriangleIcon,
  ArrowRightIcon,
  CheckCircleIcon,
  CrosshairIcon,
  DeviceMobileIcon,
  DocumentTextIcon,
  EyeIcon,
  LeafIcon,
  MapPinIcon,
  SearchIcon,
  ShieldCheckIcon,
} from "@/components/icons";
import { Logo } from "@/components/ui";

const PILLARS = [
  {
    icon: ShieldCheckIcon,
    title: "Protect",
    body: "Register phones and laptops in a vault with their IMEI and serial numbers captured up front — the proof you need if they ever go missing.",
  },
  {
    icon: CrosshairIcon,
    title: "Recover",
    body: "A tracking agent installed on the machine reports Wi-Fi positioning and IP geolocation — works indoors, on any Windows, macOS or Linux laptop.",
  },
  {
    icon: EyeIcon,
    title: "Catch",
    body: "Lost mode turns the webcam into a thief catcher, locks the screen with your message, and sounds an alarm the moment the laptop is used.",
  },
  {
    icon: LeafIcon,
    title: "Sustain",
    body: "Every recovery keeps ~300 kg of CO₂e out of the air. We connect lost laptops to repair, refurbishment and recycling — not replacement.",
  },
];

const STEPS = [
  { n: "01", title: "Register your device", body: "30 seconds. IMEI (dial *#06#) or serial number captured by the agent, or from the box/sticker." },
  { n: "02", title: "Lose it? Tap report", body: "We generate your police report (NPF NCCC / CRP) and list the IMEI/serial in the stolen registry automatically." },
  { n: "03", title: "Track & catch", body: "Follow the Wi-Fi/IP signal ladder, fire the webcam, lock the screen — make it worthless to a thief." },
  { n: "04", title: "Save the planet", body: "Recovery and repair beat replacement. Watch your CO₂e impact grow." },
];

const TESTIMONIALS = [
  {
    quote:
      "My EliteBook was stolen from a repair bench in Ikeja. The webcam caught the guy, and the stolen registry made it unsellable at Computer Village.",
    name: "Ada O.",
    role: "Lagos",
  },
  {
    quote:
      "I was about to buy a used iPhone at Computer Village and checked the IMEI here first. It came back reported stolen — dodged a bullet.",
    name: "Chinedu E.",
    role: "Enugu",
  },
  {
    quote:
      "The alarm went off the moment the thief opened my laptop at a cyber cafe. He dropped it and ran. The location ping did the rest.",
    name: "Fatima B.",
    role: "Kano",
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white">
      {/* ---------- Nav ---------- */}
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 lg:px-8">
        <Link href="/" aria-label="Dravex home">
          <Logo />
        </Link>
        <nav className="hidden items-center gap-6 text-sm font-medium text-ink-muted md:flex" aria-label="Main">
          <a href="#how" className="transition-colors hover:text-ink">How it works</a>
          <a href="#impact" className="transition-colors hover:text-ink">Impact</a>
        </nav>
        <Link href="/dashboard" className="btn-primary">
          Open dashboard <ArrowRightIcon className="h-4 w-4" />
        </Link>
      </header>

      {/* ---------- Hero ---------- */}
      <section className="relative overflow-hidden">
        <div
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            backgroundImage:
              "linear-gradient(to right, #e2e8f0 1px, transparent 1px), linear-gradient(to bottom, #e2e8f0 1px, transparent 1px)",
            backgroundSize: "56px 56px",
            maskImage: "radial-gradient(ellipse 80% 60% at 50% 0%, black 40%, transparent 100%)",
          }}
        />
        <div className="relative mx-auto max-w-6xl px-4 pb-20 pt-16 text-center lg:px-8">
          <span className="chip mx-auto bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
            Built for Nigeria · Windows, macOS & Linux · free to report
          </span>
          <h1 className="mx-auto mt-6 max-w-3xl text-4xl font-extrabold leading-tight tracking-tight text-ink sm:text-5xl lg:text-6xl">
            Never lose a laptop to theft{" "}
            <span className="bg-gradient-to-r from-primary to-primary-light bg-clip-text text-transparent">
              again.
            </span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-ink-muted">
            Install the tracking agent on your laptop. If it{"'"}s stolen, get your police report,
            stolen-device registry listing and live location in one place — and let the webcam
            catch the thief in the act.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link href="/dashboard" className="btn-primary px-6 py-3 text-base">
              Start protecting — it&apos;s free
            </Link>
            <a href="#how" className="btn-ghost px-6 py-3 text-base">
              See how it works
            </a>
          </div>

          {/* trust strip */}
          <div className="mx-auto mt-12 grid max-w-3xl grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { icon: AlertTriangleIcon, stat: "0", label: "built-in Find My on Windows/Linux" },
              { icon: CrosshairIcon, stat: "3 signals", label: "Wi-Fi · IP · last-known" },
              { icon: DocumentTextIcon, stat: "2 clicks", label: "police report + stolen registry" },
              { icon: LeafIcon, stat: "300 kg", label: "CO₂e saved per recovery" },
            ].map(({ icon: Icon, stat, label }) => (
              <div key={label} className="rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-card">
                <Icon className="h-5 w-5 text-primary" />
                <p className="mt-2 text-xl font-bold text-ink">{stat}</p>
                <p className="mt-0.5 text-xs text-ink-muted">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- Problem ---------- */}
      <section className="border-y border-slate-200 bg-surface py-16">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 lg:grid-cols-2 lg:px-8">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-accent">The problem</p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight text-ink">
              Laptops get stolen. Most never come back — because nobody can track them.
            </h2>
            <ul className="mt-6 space-y-4">
              {[
                "Laptops are prime targets in offices, schools, cyber cafes and markets",
                "Windows 'Find my device' is weak; Linux has nothing; macOS only works on Apple",
                "Victims pay informal 'trackers' ₦30,000+ with zero transparency",
                "Most owners don't know their serial number or how to report a theft properly",
              ].map((t) => (
                <li key={t} className="flex items-start gap-3 text-ink-muted">
                  <AlertTriangleIcon className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-card">
            <p className="text-sm font-semibold text-ink">The good news: the pieces exist</p>
            <p className="mt-2 text-sm leading-relaxed text-ink-muted">
              Wi-Fi positioning finds a laptop to within tens of metres indoors. A webcam photo is
              admissible evidence. The NPF{"'"}s NCCC/CRP portals accept theft reports online. And a
              public <span className="font-semibold text-ink">stolen-device registry</span> makes
              fenced laptops unsellable at Computer Village and beyond.
            </p>
            <div className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-ink-muted">
              <p className="font-semibold text-ink">Dravex wires them together:</p>
              <p className="mt-1">agent → location → webcam → police report → stolen registry.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ---------- Pillars ---------- */}
      <section className="mx-auto max-w-6xl px-4 py-16 lg:px-8">
        <div className="text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-accent">The solution</p>
          <h2 className="mt-2 text-3xl font-bold tracking-tight text-ink">One agent, four layers of protection</h2>
        </div>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {PILLARS.map(({ icon: Icon, title, body }) => (
            <div key={title} className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-card transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lift">
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-primary/10 text-primary transition-colors duration-200 group-hover:bg-primary group-hover:text-white">
                <Icon className="h-6 w-6" />
              </span>
              <h3 className="mt-4 text-lg font-bold text-ink">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-muted">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- How it works ---------- */}
      <section id="how" className="border-y border-slate-200 bg-surface py-16">
        <div className="mx-auto max-w-6xl px-4 lg:px-8">
          <div className="text-center">
            <p className="text-xs font-semibold uppercase tracking-widest text-accent">How it works</p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight text-ink">From panic to plan in four steps</h2>
          </div>
          <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {STEPS.map(({ n, title, body }) => (
              <div key={n} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card">
                <span className="font-mono text-sm font-bold text-accent">{n}</span>
                <h3 className="mt-2 font-bold text-ink">{title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{body}</p>
              </div>
            ))}
          </div>
          <div className="mt-10 grid gap-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-card md:grid-cols-3">
            {[
              { icon: MapPinIcon, t: "What if the agent isn't installed?", b: "The stolen registry + police report still work — we build your recovery kit from the IMEI/serial alone." },
              { icon: SearchIcon, t: "Buying used? Check first.", b: "Run any IMEI or serial number against the stolen registry before you pay. Free, forever." },
              { icon: DeviceMobileIcon, t: "Which devices?", b: "Laptops and desktops on Windows, macOS and Linux — one agent for your whole household." },
            ].map(({ icon: Icon, t, b }) => (
              <div key={t} className="flex gap-3">
                <Icon className="h-5 w-5 shrink-0 text-primary" />
                <div>
                  <p className="text-sm font-semibold text-ink">{t}</p>
                  <p className="mt-1 text-sm text-ink-muted">{b}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- Testimonials ---------- */}
      <section className="mx-auto max-w-6xl px-4 py-16 lg:px-8">
        <div className="text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-accent">Early users</p>
          <h2 className="mt-2 text-3xl font-bold tracking-tight text-ink">Real people, real recoveries</h2>
        </div>
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {TESTIMONIALS.map((t) => (
            <figure key={t.name} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-card">
              <CheckCircleIcon className="h-6 w-6 text-emerald-500" />
              <blockquote className="mt-3 text-sm leading-relaxed text-ink">“{t.quote}”</blockquote>
              <figcaption className="mt-4 flex items-center gap-3">
                <span className="grid h-9 w-9 place-items-center rounded-full bg-primary/10 font-bold text-primary">
                  {t.name.charAt(0)}
                </span>
                <span>
                  <span className="block text-sm font-semibold text-ink">{t.name}</span>
                  <span className="block text-xs text-ink-muted">{t.role}</span>
                </span>
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      {/* ---------- Impact band ---------- */}
      <section id="impact" className="bg-gradient-to-br from-emerald-700 to-emerald-800 py-16 text-white">
        <div className="mx-auto grid max-w-6xl items-center gap-8 px-4 lg:grid-cols-2 lg:px-8">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-emerald-300">Planet included</p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight">Recovery is climate action</h2>
            <p className="mt-4 text-emerald-100">
              Manufacturing one laptop emits ~300 kg of CO₂e. Every device we help recover — or
              connect to repair instead of replacement — is one less laptop needing to be mined,
              shipped and manufactured. That{"'"}s the ecosystem we{"'"}re building for.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {[
              { icon: LeafIcon, v: "300 kg", l: "CO₂e saved per recovered laptop" },
              { icon: DeviceMobileIcon, v: "1.6 kg", l: "e-waste kept out of landfill" },
              { icon: CrosshairIcon, v: "Phase 3", l: "verified repair & second-life market" },
              { icon: ShieldCheckIcon, v: "100%", l: "free reporting, always" },
            ].map(({ icon: Icon, v, l }) => (
              <div key={l} className="rounded-2xl bg-white/10 p-5 backdrop-blur">
                <Icon className="h-5 w-5 text-emerald-200" />
                <p className="mt-2 text-2xl font-bold">{v}</p>
                <p className="mt-0.5 text-xs text-emerald-100">{l}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- CTA ---------- */}
      <section className="mx-auto max-w-6xl px-4 py-16 lg:px-8">
        <div className="rounded-3xl bg-gradient-to-br from-primary to-primary-dark p-10 text-center text-white shadow-lift">
          <h2 className="text-3xl font-bold tracking-tight">Protect your laptop in 30 seconds</h2>
          <p className="mx-auto mt-3 max-w-xl text-blue-100">
            Free forever for vault, reporting, serial check and last-known location. Live tracking
            and webcam catch from ₦200/month — less than the price of a recharge card.
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <Link href="/dashboard" className="btn bg-white px-6 py-3 text-base text-primary hover:bg-blue-50">
              Open the dashboard
            </Link>
            <a href="#how" className="btn border border-white/40 px-6 py-3 text-base text-white hover:bg-white/10">
              How it works
            </a>
          </div>
        </div>
      </section>

      {/* ---------- Footer ---------- */}
      <footer className="border-t border-slate-200 bg-surface py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-6 px-4 sm:flex-row lg:px-8">
          <Logo size={28} />
          <p className="text-xs text-ink-faint">
            Tracking only the owner&apos;s devices with explicit consent · NDPA 2023 compliant ·
            webcam used only in lost mode, with consent
          </p>
          <div className="flex gap-4 text-xs text-ink-muted">
            <span className="cursor-pointer transition-colors hover:text-ink">Privacy</span>
            <span className="cursor-pointer transition-colors hover:text-ink">Terms</span>
            <span className="cursor-pointer transition-colors hover:text-ink">Contact</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
