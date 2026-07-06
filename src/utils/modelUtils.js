export function getAvailableModels(type, apiProviders) {
  const modelsKey =
    type === 'image' ? 'image_models' :
    type === 'text' ? 'chat_models' :
    'video_models';

  let allModels = [];

  apiProviders?.forEach(provider => {
    if (provider.enabled && provider[modelsKey]?.length > 0) {
      allModels = [...allModels, ...provider[modelsKey]];
    }
  });

  allModels = [...new Set(allModels)];

  // For image generation, filter out models that likely need image input (edit / inpaint)
  if (type === 'image') {
    allModels = allModels.filter(m => !/edit|inpaint/i.test(m));
  }

  return allModels;
}

export function findProviderForModel(model, type, apiProviders) {
  if (!model || !apiProviders?.length) return '';

  const modelsKey =
    type === 'image' ? 'image_models' :
    type === 'text' ? 'chat_models' :
    'video_models';

  // First try: find a provider whose model list contains this model
  for (const provider of apiProviders) {
    if (!provider.enabled) continue;
    if (provider[modelsKey]?.includes(model)) {
      return provider.id;
    }
  }

  // Second try: primary provider
  const primary = apiProviders.find(p => p.primary && p.enabled);
  if (primary) return primary.id;

  // Third try: first enabled provider
  const first = apiProviders.find(p => p.enabled);
  if (first) return first.id;

  return '';
}
