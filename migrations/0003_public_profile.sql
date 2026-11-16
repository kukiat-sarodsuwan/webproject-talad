ALTER TABLE settings ADD COLUMN published INTEGER NOT NULL DEFAULT 0 CHECK (published IN (0, 1));
ALTER TABLE settings ADD COLUMN theme TEXT NOT NULL DEFAULT 'leaf' CHECK (theme IN ('leaf', 'ocean', 'clay'));
