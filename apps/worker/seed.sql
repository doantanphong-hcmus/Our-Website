INSERT INTO couple_spaces (id, name)
VALUES ('couple-main', 'Phong & Nhi')
ON CONFLICT (id) DO NOTHING;

-- The leading ! makes these development placeholders impossible to authenticate.
-- P1.5 replaces them with real password hashes; plaintext passwords never enter SQL.
INSERT INTO users (
  id, couple_space_id, username, password_hash, display_name, nickname, color, role
)
VALUES
  ('user-phong', 'couple-main', 'phong', '!auth-not-configured', 'Phong', 'Phong', '#9F3F59', 'boyfriend'),
  ('user-nhi', 'couple-main', 'nhi', '!auth-not-configured', 'Nhi', 'Nhi', '#3F6F61', 'girlfriend')
ON CONFLICT (id) DO NOTHING;

INSERT INTO user_preferences (user_id)
VALUES ('user-phong'), ('user-nhi')
ON CONFLICT (user_id) DO NOTHING;
