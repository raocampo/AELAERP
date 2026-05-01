const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_REGEX = /^[a-z0-9._-]{3,40}$/;

const normalizarLogin = (value) => String(value || '').trim().toLowerCase();

const normalizarUsername = (value) => normalizarLogin(value);

const normalizarEmail = (value) => {
  const email = normalizarLogin(value);
  return email || null;
};

const esUsernameValido = (value) => USERNAME_REGEX.test(normalizarUsername(value));

const esEmailValido = (value) => {
  const email = normalizarEmail(value);
  return !email || EMAIL_REGEX.test(email);
};

const mensajeDuplicidadUsuario = (error) => {
  const targets = Array.isArray(error?.meta?.target) ? error.meta.target : [];

  if (targets.includes('username')) {
    return 'El usuario ya está registrado';
  }

  if (targets.includes('email')) {
    return 'El correo ya está registrado';
  }

  return 'Ya existe un registro con esos datos';
};

module.exports = {
  normalizarLogin,
  normalizarUsername,
  normalizarEmail,
  esUsernameValido,
  esEmailValido,
  mensajeDuplicidadUsuario,
};
