import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailerService } from '@nestjs-modules/mailer';
import { Pool } from 'pg';
import { readdir } from 'node:fs/promises';

@Injectable()
export class AppService implements OnModuleInit {
  private readonly logger = new Logger(AppService.name);
  private readonly pool: Pool;

  constructor(
    private readonly config: ConfigService,
    private readonly mailer: MailerService,
  ) {
    this.pool = new Pool({ connectionString: this.config.get<string>('DATABASE_URL') });
    // Un client idle qui perd sa connexion (db redemarree) fait emettre 'error' au
    // pool ; sans listener, Node tue le process au lieu de rouvrir une connexion.
    this.pool.on('error', (error) => this.logger.warn(`Connexion Postgres perdue : ${error.message}`));
  }

  async onModuleInit() {
    // Sans compose il n'y a pas de depends_on : au `docker start` l'API peut demarrer
    // avant Postgres.
    for (let attempt = 1; ; attempt++) {
      try {
        await this.pool.query(
          'CREATE TABLE IF NOT EXISTS visits (id SERIAL PRIMARY KEY, seen_at TIMESTAMPTZ NOT NULL DEFAULT now())',
        );
        return;
      } catch (error) {
        if (attempt >= 30) throw error;
        this.logger.warn(`Postgres pas encore pret (essai ${attempt}), nouvelle tentative dans 2s`);
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
  }

  async getStatus() {
    const { rows } = await this.pool.query<{ count: string; now: Date }>(
      'INSERT INTO visits DEFAULT VALUES RETURNING (SELECT count(*) FROM visits) AS count, now()',
    );
    return {
      message: 'Hello depuis NestJS 👋',
      database: { visits: Number(rows[0].count), time: rows[0].now },
    };
  }

  async listUploads() {
    return readdir(this.config.get<string>('UPLOAD_DIR') ?? 'uploads');
  }

  async sendMail(to: string) {
    await this.mailer.sendMail({
      to,
      subject: 'Coucou depuis le backend dockerisé',
      html: `<h1>Ça marche 🎉</h1><p>Envoyé à ${new Date().toISOString()}</p>`,
    });
    return { sent: true, to };
  }
}
