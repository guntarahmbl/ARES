export const loadMarsWalk = () => import('../components/MarsWalk')

export const preloadMarsWalk = () => {
  void loadMarsWalk()
}
