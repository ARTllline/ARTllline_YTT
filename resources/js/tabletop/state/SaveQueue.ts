import { t } from '../../i18n';
export type SaveState = { status: 'saved' | 'saving' | 'failed'; error: string | null };
type Job = { key: string; run: () => Promise<void> };
/** Serial, explicit commands only. A failed head blocks later writes until retry. */
export class SaveQueue {
    private jobs: Job[] = [];
    private running = false;
    private timer: ReturnType<typeof setTimeout> | undefined;
    private state: SaveState = { status: 'saved', error: null };
    private listeners = new Set<() => void>();
    getSnapshot = () => this.state;
    subscribe = (fn: () => void) => {
        this.listeners.add(fn);
        return () => {
            this.listeners.delete(fn);
        };
    };
    private publish(state: SaveState) {
        this.state = state;
        this.listeners.forEach((fn) => fn());
    }
    enqueue(key: string, run: () => Promise<void>, debounce = 0) {
        const existing = this.jobs.findIndex(
            (job, index) => job.key === key && !(index === 0 && this.running),
        );
        if (debounce && existing >= 0) this.jobs[existing] = { key, run };
        else this.jobs.push({ key, run });
        if (this.state.status === 'failed') return;
        this.publish({ status: 'saving', error: null });
        clearTimeout(this.timer);
        if (debounce) this.timer = setTimeout(() => void this.drain(), debounce);
        else void this.drain();
    }
    private async drain() {
        if (this.running || this.state.status === 'failed') return;
        this.running = true;
        while (this.jobs.length) {
            try {
                await this.jobs[0].run();
                this.jobs.shift();
            } catch (error) {
                this.running = false;
                this.publish({
                    status: 'failed',
                    error: error instanceof Error ? error.message : t('Save failed. Please retry.'),
                });
                return;
            }
        }
        this.running = false;
        this.publish({ status: 'saved', error: null });
    }
    retry = () => {
        if (this.running) return;
        this.publish({ status: 'saving', error: null });
        void this.drain();
    };
    async flush(): Promise<void> {
        clearTimeout(this.timer);
        void this.drain();
        if (this.state.status === 'saved') return;
        if (this.state.status === 'failed') throw new Error(this.state.error!);
        await new Promise<void>((resolve, reject) => {
            const unsubscribe = this.subscribe(() => {
                if (this.state.status === 'saving') return;
                unsubscribe();
                if (this.state.status === 'failed') reject(new Error(this.state.error!));
                else resolve();
            });
        });
    }
}
