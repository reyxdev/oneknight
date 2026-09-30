CREATE TABLE "broadcasts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"text" text NOT NULL,
	"segment" text NOT NULL,
	"recipients" integer NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ideas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"user_id" uuid,
	"text" text NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reply_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ideas_status_idx" ON "ideas" USING btree ("status","created_at");--> statement-breakpoint
INSERT INTO "reply_templates" ("title", "body", "sort") VALUES
('Привітання', 'Вітаю, {name}! Дякуємо за звернення №{n}. Вже дивимось і відповімо сьогодні в робочий час (Пн–Пт 10:00–18:00).', 1),
('Потрібні деталі', '{name}, щоб розібратися швидше, напишіть, будь ласка: що саме ви робили, що очікували побачити і що сталося. Якщо можна — додайте знімок екрана.', 2),
('Ключ Нової пошти', 'Ключ API Нової пошти створюється в особистому кабінеті Нової пошти: «Налаштування → Безпека → Створити ключ». Скопіюйте його в ONEKNIGHT: «Бізнес → Інтеграції → Нова пошта».', 3),
('Додати менеджера', 'Менеджера додає власник: «Команда → Запросити людину», оберіть роль і права, надішліть посилання-запрошення людині. Після реєстрації за посиланням вона одразу в команді.', 4),
('Поповнення балансу', 'Поповнити баланс можна в розділі «Оплата»: вкажіть суму, отримаєте реквізити з кодом платежу. Гроші зараховуються, щойно ми побачимо переказ (зазвичай у той самий робочий день).', 5),
('Скрипт ok.js', 'Скрипт ok.js вставляється на всі сторінки сайту перед </body>. Готовий код із вашим ключем — у розділі «Сайт». Щойно сайт уперше звернеться до ONEKNIGHT, крок у «Перших кроках» позначиться сам.', 6),
('Забули пароль', 'Якщо Telegram підключено до ONEKNIGHT, новий пароль можна задати самостійно: «Забули пароль?» на сторінці входу. Якщо ні — напишіть нам із номера, вказаного в акаунті, і ми надішлемо одноразове посилання.', 7),
('Помилку знайдено', '{name}, дякуємо! Ми відтворили помилку і вже виправляємо. Напишемо тут, щойно виправлення буде на сервері.', 8),
('Ідея записана', 'Дякуємо за ідею! Записали її в план. Коли зробимо — повідомимо в панелі.', 9),
('Закриваємо звернення', 'Радий, що все вирішилось! Закриваю звернення №{n}. Якщо щось ще — пишіть у будь-який час.', 10);
